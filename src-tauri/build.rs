fn main() {
    println!("cargo:rerun-if-env-changed=PCIE_WIN7_PUBLIC_VERSION");
    println!("cargo:rerun-if-env-changed=PCIE_WIN7_MSI_VERSION");
    tauri_build::build()
}
