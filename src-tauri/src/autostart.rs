// Keep the existing autostart IPC/capability contract on every desktop platform.
// auto-launch 0.5 writes an unquoted Windows executable path; implement that
// platform adapter here rather than upgrading the entire Tauri dependency tree.
#[cfg(not(windows))]
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None)
}

#[cfg(any(windows, test))]
fn startup_command(executable: &str) -> String {
    format!("\"{executable}\"")
}

#[cfg(any(windows, test))]
fn legacy_command_matches(command: &str, executable: &str) -> bool {
    // The old plugin wrote `current_exe + " "`, with no startup arguments.
    command.trim_end().eq_ignore_ascii_case(executable)
}

#[cfg(any(windows, test))]
fn command_matches(command: &str, executable: &str) -> bool {
    command
        .trim_end()
        .eq_ignore_ascii_case(&startup_command(executable))
}

#[cfg(any(windows, test))]
fn startup_approved(bytes: &[u8]) -> bool {
    // StartupApproved uses a DWORD state followed by a FILETIME. Both enabled
    // states (2 and 6) are valid; malformed/unknown values are not approval.
    bytes.len() == 12 && matches!(&bytes[..4], [2, 0, 0, 0] | [6, 0, 0, 0])
}

#[cfg(windows)]
mod windows {
    use super::{command_matches, legacy_command_matches, startup_approved, startup_command};
    use std::io::{self, ErrorKind};
    use tauri::{plugin::Builder, Manager, Runtime, State};
    use winreg::{
        enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_BINARY},
        RegKey, RegValue,
    };

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const APPROVED: &str =
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

    struct WindowsAutostart {
        name: String,
        executable: String,
        run_key: String,
        approved_key: String,
    }

    // Missing registry keys/values are normal on first use; propagate all other
    // failures so an unreadable state can never masquerade as enabled/disabled.
    fn optional<T>(result: io::Result<T>) -> io::Result<Option<T>> {
        match result {
            Ok(value) => Ok(Some(value)),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    impl WindowsAutostart {
        fn read_command(&self) -> io::Result<Option<String>> {
            let key = optional(
                RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(&self.run_key, KEY_READ),
            )?;
            match key {
                Some(key) => optional(key.get_value(&self.name)),
                None => Ok(None),
            }
        }

        fn repair_legacy_command(&self) -> io::Result<()> {
            if self
                .read_command()?
                .is_some_and(|value| legacy_command_matches(&value, &self.executable))
            {
                let key = RegKey::predef(HKEY_CURRENT_USER)
                    .open_subkey_with_flags(&self.run_key, KEY_WRITE)?;
                key.set_value(&self.name, &startup_command(&self.executable))?;
            }
            // Never touch StartupApproved during repair: a system disable wins.
            Ok(())
        }

        fn enabled(&self) -> io::Result<bool> {
            if !self
                .read_command()?
                .is_some_and(|value| command_matches(&value, &self.executable))
            {
                return Ok(false);
            }
            let key = optional(
                RegKey::predef(HKEY_CURRENT_USER)
                    .open_subkey_with_flags(&self.approved_key, KEY_READ),
            )?;
            let approval = match key {
                Some(key) => optional(key.get_raw_value(&self.name))?,
                None => None,
            };
            Ok(approval.map_or(true, |value| {
                value.vtype == REG_BINARY && startup_approved(&value.bytes)
            }))
        }

        fn enable(&self) -> io::Result<()> {
            let user = RegKey::predef(HKEY_CURRENT_USER);
            let (run, _) = user.create_subkey(&self.run_key)?;
            run.set_value(&self.name, &startup_command(&self.executable))?;
            // Only the explicit enable action overrides a task-manager disable.
            let (approved, _) = user.create_subkey(&self.approved_key)?;
            approved.set_raw_value(
                &self.name,
                &RegValue {
                    vtype: REG_BINARY,
                    bytes: vec![2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                },
            )
        }

        fn disable(&self) -> io::Result<()> {
            let key = optional(
                RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(&self.run_key, KEY_WRITE),
            )?;
            if let Some(key) = key {
                optional(key.delete_value(&self.name))?;
            }
            Ok(())
        }
    }

    #[tauri::command]
    fn enable(state: State<'_, WindowsAutostart>) -> Result<(), String> {
        state.enable().map_err(|error| error.to_string())
    }

    #[tauri::command]
    fn disable(state: State<'_, WindowsAutostart>) -> Result<(), String> {
        state.disable().map_err(|error| error.to_string())
    }

    #[tauri::command]
    fn is_enabled(state: State<'_, WindowsAutostart>) -> Result<bool, String> {
        state.enabled().map_err(|error| error.to_string())
    }

    pub fn init<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
        Builder::new("autostart")
            .invoke_handler(tauri::generate_handler![enable, disable, is_enabled])
            .setup(|app, _| {
                let state = WindowsAutostart {
                    name: app.package_info().name.clone(),
                    executable: std::env::current_exe()?
                        .to_str()
                        .ok_or("Autostart executable path is not valid Unicode")?
                        .to_owned(),
                    run_key: RUN.into(),
                    approved_key: APPROVED.into(),
                };
                if let Err(error) = state.repair_legacy_command() {
                    eprintln!("[Autostart] Failed to repair legacy startup command: {error}");
                }
                app.manage(state);
                Ok(())
            })
            .build()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn registry_roundtrip_and_legacy_repair_preserve_system_disable() {
            // Use an isolated temporary HKCU branch, never the user's login keys.
            let base = format!(r"Software\PCIE\AutostartTests\{}", uuid::Uuid::new_v4());
            let user = RegKey::predef(HKEY_CURRENT_USER);
            struct Cleanup(String);
            impl Drop for Cleanup {
                fn drop(&mut self) {
                    let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(&self.0);
                }
            }
            let _cleanup = Cleanup(base.clone());
            let state = WindowsAutostart {
                name: "PCIE".into(),
                executable: r"C:\Program Files\全医慧助\pcie.exe".into(),
                run_key: format!(r"{base}\Run"),
                approved_key: format!(r"{base}\Approved"),
            };
            assert!(!state.enabled().unwrap());
            state.disable().unwrap();
            state.repair_legacy_command().unwrap();
            assert!(state.read_command().unwrap().is_none());
            state.enable().unwrap();
            assert!(state.enabled().unwrap());
            assert_eq!(
                state.read_command().unwrap().unwrap(),
                r#""C:\Program Files\全医慧助\pcie.exe""#
            );
            let (run, _) = user.create_subkey(&state.run_key).unwrap();
            let (approved, _) = user.create_subkey(&state.approved_key).unwrap();
            run.set_value(&state.name, &format!("{} ", state.executable))
                .unwrap();
            state.repair_legacy_command().unwrap();
            assert!(state.enabled().unwrap());
            run.set_value(&state.name, &format!("{} ", state.executable))
                .unwrap();
            let disabled = RegValue {
                vtype: REG_BINARY,
                bytes: vec![3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            };
            approved.set_raw_value(&state.name, &disabled).unwrap();
            state.repair_legacy_command().unwrap();
            assert!(command_matches(
                &state.read_command().unwrap().unwrap(),
                &state.executable
            ));
            assert!(!state.enabled().unwrap());
            assert_eq!(
                approved.get_raw_value(&state.name).unwrap().bytes,
                disabled.bytes
            );
            state.enable().unwrap();
            assert!(state.enabled().unwrap());
            approved
                .set_raw_value(
                    &state.name,
                    &RegValue {
                        vtype: REG_BINARY,
                        bytes: vec![2],
                    },
                )
                .unwrap();
            assert!(!state.enabled().unwrap());
            state.enable().unwrap();
            run.set_value(&state.name, &r#""C:\Old PCIE\pcie.exe""#)
                .unwrap();
            assert!(!state.enabled().unwrap());
            state.repair_legacy_command().unwrap();
            assert_eq!(
                state.read_command().unwrap().unwrap(),
                r#""C:\Old PCIE\pcie.exe""#
            );
            state.disable().unwrap();
            state.disable().unwrap();
            assert!(!state.enabled().unwrap());
        }
    }
}

#[cfg(windows)]
pub use windows::init;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_full_executable_paths_including_spaces_and_chinese() {
        for path in [
            r"C:\Program Files\PCIE\pcie.exe",
            r"D:\临床 工作站\pcie.exe",
            r"C:\PCIE\pcie.exe",
        ] {
            assert_eq!(startup_command(path), format!("\"{path}\""));
            assert!(command_matches(&startup_command(path), path));
            assert!(!command_matches(&format!("{path} "), path));
            assert!(legacy_command_matches(&format!("{path} "), path));
        }
    }

    #[test]
    fn rejects_wrong_paths_and_unexpected_arguments() {
        let path = r"C:\Program Files\PCIE\pcie.exe";
        assert!(command_matches(
            r#""c:\program files\pcie\PCIE.EXE" "#,
            path
        ));
        for invalid in [
            r#""C:\Old PCIE\pcie.exe""#,
            r#""C:\Program Files\PCIE\pcie.exe" --other"#,
            r"C:\Program.exe",
        ] {
            assert!(!command_matches(invalid, path));
            assert!(!legacy_command_matches(invalid, path));
        }
    }

    #[test]
    fn system_approval_requires_a_valid_enabled_state() {
        for state in [2, 6] {
            let mut bytes = vec![0; 12];
            bytes[0] = state;
            assert!(startup_approved(&bytes));
        }
        for state in [0, 1, 3, 7, 255] {
            let mut bytes = vec![0; 12];
            bytes[0] = state;
            assert!(!startup_approved(&bytes));
        }
        assert!(!startup_approved(&[]));
        assert!(!startup_approved(&[2]));
    }
}
