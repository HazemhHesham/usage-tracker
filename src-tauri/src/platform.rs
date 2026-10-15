use std::path::PathBuf;

#[derive(Default)]
pub struct WidgetPlacement {
    pub manually_moved: std::sync::atomic::AtomicBool,
}

/// Dock flush to the taskbar until dragged; then only keep the meter on-screen.
#[cfg(target_os = "windows")]
pub fn position_codex_widget(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("codex-widget") else {
        return Ok(());
    };
    let manual = app
        .state::<WidgetPlacement>()
        .manually_moved
        .load(std::sync::atomic::Ordering::Relaxed);
    let monitor = if manual {
        window.current_monitor()?
    } else {
        window.primary_monitor()?
    };
    let Some(monitor) = monitor else {
        return Ok(());
    };
    let area = monitor.work_area();
    let size = window.outer_size()?;
    let right = (area.position.x + area.size.width as i32 - size.width as i32).max(area.position.x);
    let bottom =
        (area.position.y + area.size.height as i32 - size.height as i32).max(area.position.y);
    let current = window.outer_position()?;
    let position = if manual {
        tauri::PhysicalPosition::new(
            current.x.clamp(area.position.x, right),
            current.y.clamp(area.position.y, bottom),
        )
    } else {
        tauri::PhysicalPosition::new(right, bottom)
    };
    if window.outer_position()? != position {
        window.set_position(position)?;
    }
    Ok(())
}

/// Native Windows tools store their dot-directories under USERPROFILE.
pub fn home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let names = ["USERPROFILE", "HOME"];
    #[cfg(not(target_os = "windows"))]
    let names = ["HOME", "USERPROFILE"];
    names.into_iter().find_map(|name| {
        std::env::var_os(name)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
    })
}
