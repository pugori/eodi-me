//! Pipeline helper sub-modules.
//!
//! * [`cities`] — parse `cities15000.txt`, assemble `CityData` from the
//!   country cache
//! * [`vdb`]    — build and encrypt the 15-D city vector database
//! * [`auto`]   — auto-mode: detect cities file, run full pipeline

pub mod auto;
pub mod cities;
pub mod vdb;
