use std::fmt::Display;

pub type CmdResult<T> = Result<T, String>;

pub fn map_err<E: Display>(e: E) -> String {
    e.to_string()
}
