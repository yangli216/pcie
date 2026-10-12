# Win7-only windows-link 0.2.1 patch

Derived from Microsoft windows-rs `windows-link` 0.2.1 (MIT license, included).
Only the Win7 Cargo runner selects this crate; ordinary builds use crates.io.

The three named COM functions existed in Windows 7 in `ole32.dll`. Newer
windows-core imports them from `combase.dll`, which Windows 7 does not have.
This patch changes only those three bindings. All other imports retain their
original DLL; unavailable WinRT functions are never replaced with stubs.
`windows_slim_errors` separately removes the WinRT error origination call.

The MSI import gate must pass after every dependency/patch update. This patch
does not establish that arbitrary newer Windows APIs work on Windows 7.
