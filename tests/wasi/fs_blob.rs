// ```javascript
// return {
//   fs: { foo: { blob: new Blob(["foobarbaz"])} }
// };
// ```

use std::fs;
use std::io::{Read, Write};

fn main() {
    assert!(fs::metadata("foo/blob").unwrap().is_file());
    assert_eq!(fs::metadata("foo/blob").unwrap().len(), 9);

    // Writing to blobs not supported.
    {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .open("foo/blob")
            .unwrap();
        assert!(file.write_all(b"foobarbazz").is_ok());
    }

    {
        let mut file_handle = fs::OpenOptions::new().read(true).open("foo/blob").unwrap();

        let mut test = String::new();
        file_handle.read_to_string(&mut test);

        assert_eq!(&test, "foobarbazz");
    }
}
