//! bsdiff's `BSDIFF40` patches for WebAssembly, through `qbsdiff`. The module imports nothing.
//! The host copies the inputs into buffers from `alloc`, calls `diff` or `apply`,
//! and reads the result at the returned `(pointer << 32) | length`.

use qbsdiff::{Bsdiff, Bspatch, ParallelScheme};
use std::slice;

#[unsafe(no_mangle)]
pub extern "C" fn alloc(length: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; length].into_boxed_slice()).cast()
}

/// Creates the patch that turns `source` into `target`.
///
/// # Safety
/// Both pointer and length pairs must describe buffers returned by `alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn diff(
    source: *const u8,
    source_length: usize,
    target: *const u8,
    target_length: usize,
) -> u64 {
    let (source, target) = unsafe {
        (
            slice::from_raw_parts(source, source_length),
            slice::from_raw_parts(target, target_length),
        )
    };
    let mut patch = Vec::new();
    Bsdiff::new(source, target)
        .parallel_scheme(ParallelScheme::Never)
        .compare(&mut patch)
        .expect("writing to memory cannot fail");
    into_packed_buffer(patch)
}

/// Applies `patch` to `source`; a patch that does not fit its source traps.
///
/// # Safety
/// Both pointer and length pairs must describe buffers returned by `alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn apply(
    source: *const u8,
    source_length: usize,
    patch: *const u8,
    patch_length: usize,
) -> u64 {
    let (source, patch) = unsafe {
        (
            slice::from_raw_parts(source, source_length),
            slice::from_raw_parts(patch, patch_length),
        )
    };
    let mut target = Vec::new();
    Bspatch::new(patch)
        .and_then(|patcher| patcher.apply(source, &mut target))
        .expect("a BSDIFF40 patch that fits its source");
    into_packed_buffer(target)
}

/// Hands the bytes to the host, which frees them with the instance.
fn into_packed_buffer(bytes: Vec<u8>) -> u64 {
    let length = bytes.len() as u64;
    let pointer = Box::into_raw(bytes.into_boxed_slice()).cast::<u8>() as u64;
    (pointer << 32) | length
}
