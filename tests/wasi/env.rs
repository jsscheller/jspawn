// ```json
// {
//   "env": { "FOO": "foo", "BAR": "bar", "BAZ": "baz" },
//   "args": [ "foo", "bar", "baz" ]
// }
// ```

use std::env;

fn main() {
    let vars = env::vars().collect::<Vec<(String, String)>>();
    assert_eq!(vars.len(), 3);
    assert_eq!(vars[0], ("FOO".to_string(), "foo".to_string()));
    assert_eq!(vars[1], ("BAR".to_string(), "bar".to_string()));
    assert_eq!(vars[2], ("BAZ".to_string(), "baz".to_string()));

    let args = env::args().collect::<Vec<String>>();
    assert_eq!(args.len(), 4);
    assert!(args[0].ends_with("env.wasm"));
    assert_eq!(args[1], "foo");
    assert_eq!(args[2], "bar");
    assert_eq!(args[3], "baz");
}
