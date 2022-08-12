// ```json
// {
//   "fs": { "foo": {} }
// }
// ```

use std::fs;
use std::io::{Read, Write};
use std::os::wasi::prelude::AsRawFd;

fn main() {
    // Existing
    assert!(fs::create_dir("foo").is_err());

    // Creating file at root
    assert!(fs::create_dir("bar").is_ok());

    assert!(fs::create_dir("foo/bar").is_ok());
    assert!(fs::metadata("foo/bar").unwrap().is_dir());

    assert!(fs::File::create("foo/new_file").is_ok());
    assert!(fs::metadata("foo/new_file").unwrap().is_file());

    assert!(fs::rename("foo/bar", "foo/baz").is_ok());
    assert!(fs::rename("foo/new_file", "foo/new_renamed_file").is_ok());

    // Renaming preopen not allowed
    // assert!(fs::rename("foo", "bar").is_err());

    assert!(fs::remove_file("foo/new_renamed_file").is_ok());

    assert!(fs::File::create("foo/baz/new_file").is_ok());
    assert!(fs::remove_dir("foo/baz").is_err());
    assert!(fs::remove_file("foo/baz/new_file").is_ok());
    assert!(fs::remove_dir("foo/baz").is_ok());

    // Removing preopen not allowed
    // assert!(fs::remove_dir("foo").is_err());

    {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open("foo/fd_allocate")
            .unwrap();
        let mut buffer = [0u8; 64];

        file.write_all(b"foo bar baz").unwrap();
        let raw_fd = file.as_raw_fd();
        file.flush();
        let len = file.metadata().unwrap().len();
        assert_eq!(len, 11);
        unsafe { fd_allocate(raw_fd, len, 1234) };
        let len = file.metadata().unwrap().len();
        assert_eq!(len, 1234 + 11);

        #[link(wasm_import_module = "wasi_snapshot_preview1")]
        extern "C" {
            fn fd_allocate(fd: i32, offset: u64, length: u64) -> u16;
        }
    }

    {
        static STR1: &str = "Hello, world!\n";
        static STR2: &str = "Goodbye, world!\n";

        let file = "foo/fd_append";

        {
            let mut file_handle = fs::OpenOptions::new()
                .create_new(true)
                .append(true)
                .open(&file)
                .unwrap();
            file_handle.write(STR1.as_bytes()).unwrap();
        }
        {
            let mut file_handle = fs::OpenOptions::new().append(true).open(&file).unwrap();
            file_handle.write(STR2.as_bytes()).unwrap();
        }

        {
            let mut file_handle = fs::OpenOptions::new().read(true).open(&file).unwrap();

            let mut test = String::new();
            file_handle.read_to_string(&mut test);

            assert_eq!(&test, &format!("{}{}", STR1, STR2));
        }
    }

    {
        assert!(fs::File::create("foo/new_file").is_ok());
        let file = fs::File::open("foo/new_file").unwrap();
        let file_fd = file.as_raw_fd();
        let stdout_fd = std::io::stdout().as_raw_fd();
        let stderr_fd = std::io::stderr().as_raw_fd();
        let stdin_fd = std::io::stdin().as_raw_fd();

        assert_eq!(unsafe { fd_close(file_fd) }, 0);
        assert_eq!(unsafe { fd_close(stderr_fd) }, 0);
        assert_eq!(unsafe { fd_close(stdin_fd) }, 0);
        assert_eq!(unsafe { fd_close(stdout_fd) }, 0);

        #[link(wasm_import_module = "wasi_snapshot_preview1")]
        extern "C" {
            fn fd_close(fd: i32) -> u16;
        }
    }
}
