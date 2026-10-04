//! Stands in for `cdivsufsort`, whose C sources need a C toolchain for WebAssembly,
//! with the pure-Rust port of the same algorithm by the same author.

pub use divsufsort::sort_in_place;
