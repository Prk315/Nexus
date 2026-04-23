use crate::config::settings::timetracker_dir;
use std::fs;
use uuid::Uuid;

pub fn get_or_create() -> String {
    let path = timetracker_dir().join("device_id");
    if let Ok(id) = fs::read_to_string(&path) {
        let id = id.trim().to_string();
        if !id.is_empty() {
            return id;
        }
    }
    let id = Uuid::new_v4().to_string();
    let _ = fs::write(&path, &id);
    id
}
