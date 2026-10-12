#![no_std]

// Upstream windows-link 0.2.1 with only three Win7 COM import mappings.
#[macro_export]
macro_rules! link {
    ("combase.dll" $abi:literal fn CoTaskMemAlloc $($signature:tt)*) => {
        $crate::link!("ole32.dll" $abi fn CoTaskMemAlloc $($signature)*);
    };
    ("combase.dll" $abi:literal fn CoTaskMemFree $($signature:tt)*) => {
        $crate::link!("ole32.dll" $abi fn CoTaskMemFree $($signature)*);
    };
    ("combase.dll" $abi:literal fn CoCreateFreeThreadedMarshaler $($signature:tt)*) => {
        $crate::link!("ole32.dll" $abi fn CoCreateFreeThreadedMarshaler $($signature)*);
    };
    ($library:literal $abi:literal $($link_name:literal)? fn $($function:tt)*) => {
        $crate::raw_link!($library $abi $($link_name)? fn $($function)*);
    };
}

#[cfg(all(windows, target_arch = "x86"))]
#[doc(hidden)]
#[macro_export]
macro_rules! raw_link {
    ($library:literal $abi:literal $($link_name:literal)? fn $($function:tt)*) => (
        #[link(name = $library, kind = "raw-dylib", modifiers = "+verbatim", import_name_type = "undecorated")]
        extern $abi {
            $(#[link_name=$link_name])?
            pub fn $($function)*;
        }
    )
}

#[cfg(all(windows, not(target_arch = "x86")))]
#[doc(hidden)]
#[macro_export]
macro_rules! raw_link {
    ($library:literal $abi:literal $($link_name:literal)? fn $($function:tt)*) => (
        #[link(name = $library, kind = "raw-dylib", modifiers = "+verbatim")]
        extern $abi {
            $(#[link_name=$link_name])?
            pub fn $($function)*;
        }
    )
}

#[cfg(not(windows))]
#[doc(hidden)]
#[macro_export]
macro_rules! raw_link {
    ($library:literal $abi:literal $($link_name:literal)? fn $($function:tt)*) => (
        extern $abi {
            pub fn $($function)*;
        }
    )
}
