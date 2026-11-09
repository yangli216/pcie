use tauri::{PhysicalPosition, PhysicalSize, Window};

#[derive(Debug, PartialEq)]
pub struct MouseHoverSnapshot {
    pub is_hovered: bool,
    /// Window-relative physical pixels, matching the `mouse-pos` event contract.
    pub x: f64,
    pub y: f64,
}

fn calculate_hover(
    mouse: PhysicalPosition<f64>,
    window_position: PhysicalPosition<i32>,
    window_size: PhysicalSize<u32>,
    cursor_to_window_scale: f64,
) -> MouseHoverSnapshot {
    let x = mouse.x * cursor_to_window_scale - f64::from(window_position.x);
    let y = mouse.y * cursor_to_window_scale - f64::from(window_position.y);

    MouseHoverSnapshot {
        is_hovered: x >= 0.0
            && x <= f64::from(window_size.width)
            && y >= 0.0
            && y <= f64::from(window_size.height),
        x,
        y,
    }
}

#[cfg(target_os = "macos")]
fn cursor_to_window_scale(window: &Window) -> Result<f64, String> {
    // Tao 0.35.3 scales NSEvent's global cursor by the primary monitor scale,
    // but scales the window position/size by the window's own backing scale.
    let primary_monitor = window
        .primary_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Primary monitor unavailable while sampling mouse hover".to_string())?;
    let window_scale = window.scale_factor().map_err(|error| error.to_string())?;
    Ok(window_scale / primary_monitor.scale_factor())
}

#[cfg(not(target_os = "macos"))]
fn cursor_to_window_scale(_window: &Window) -> Result<f64, String> {
    Ok(1.0)
}

pub fn sample_mouse_hover(window: &Window) -> Result<MouseHoverSnapshot, String> {
    let mouse = window
        .cursor_position()
        .map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let scale = cursor_to_window_scale(window)?;

    Ok(calculate_hover(mouse, position, size, scale))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retina_primary_to_one_x_window_uses_window_coordinates() {
        let actual = calculate_hover(
            PhysicalPosition::new(4160.0, 360.0),
            PhysicalPosition::new(2000, 100),
            PhysicalSize::new(160, 160),
            1.0 / 2.0,
        );

        assert_eq!(
            actual,
            MouseHoverSnapshot {
                is_hovered: true,
                x: 80.0,
                y: 80.0,
            }
        );
    }

    #[test]
    fn one_x_primary_to_retina_window_keeps_relative_physical_pixels() {
        let actual = calculate_hover(
            PhysicalPosition::new(2080.0, 180.0),
            PhysicalPosition::new(4000, 200),
            PhysicalSize::new(320, 320),
            2.0 / 1.0,
        );

        assert_eq!(
            actual,
            MouseHoverSnapshot {
                is_hovered: true,
                x: 160.0,
                y: 160.0,
            }
        );
    }

    #[test]
    fn equal_scales_preserve_existing_physical_coordinate_behavior() {
        let actual = calculate_hover(
            PhysicalPosition::new(3200.0, 800.0),
            PhysicalPosition::new(3040, 640),
            PhysicalSize::new(320, 320),
            1.0,
        );

        assert_eq!(
            actual,
            MouseHoverSnapshot {
                is_hovered: true,
                x: 160.0,
                y: 160.0,
            }
        );
    }

    #[test]
    fn monitors_left_and_above_primary_keep_negative_global_coordinates() {
        let actual = calculate_hover(
            PhysicalPosition::new(-2240.0, -1240.0),
            PhysicalPosition::new(-1200, -700),
            PhysicalSize::new(160, 160),
            0.5,
        );

        assert_eq!(
            actual,
            MouseHoverSnapshot {
                is_hovered: true,
                x: 80.0,
                y: 80.0,
            }
        );
    }

    #[test]
    fn ball_window_preserves_inclusive_edges_and_rejects_each_outside_edge() {
        for (mouse_x, mouse_y, expected_hover) in [
            (4000.0, 200.0, true),
            (4320.0, 520.0, true),
            (3999.0, 360.0, false),
            (4321.0, 360.0, false),
            (4160.0, 199.0, false),
            (4160.0, 521.0, false),
        ] {
            let actual = calculate_hover(
                PhysicalPosition::new(mouse_x, mouse_y),
                PhysicalPosition::new(2000, 100),
                PhysicalSize::new(160, 160),
                0.5,
            );
            assert_eq!(actual.is_hovered, expected_hover, "{actual:?}");
        }
    }

    #[test]
    fn all_four_ring_buttons_remain_hovered_with_correct_event_coordinates() {
        for (mouse_x, mouse_y, expected_x, expected_y) in [
            (4156.0, 248.0, 78.0, 24.0),
            (4272.0, 366.0, 136.0, 83.0),
            (4156.0, 472.0, 78.0, 136.0),
            (4048.0, 366.0, 24.0, 83.0),
        ] {
            let actual = calculate_hover(
                PhysicalPosition::new(mouse_x, mouse_y),
                PhysicalPosition::new(2000, 100),
                PhysicalSize::new(160, 160),
                0.5,
            );
            assert_eq!(
                actual,
                MouseHoverSnapshot {
                    is_hovered: true,
                    x: expected_x,
                    y: expected_y,
                }
            );
        }
    }
}
