"""Validation independent of Frappe, so saved schema compatibility is testable."""
LINK_TYPES = {"DocType", "Report", "Page", "Workspace", "Dashboard", "Sidebar", "Workspace Sidebar", "External", "URL"}
COMPONENT_TYPES = {"heading", "text", "shortcut", "chart", "number_card", "quick_list", "spacer"}


def validate_design(layout, navigation, dock, strict=False):
    errors = []
    for obj, key in ((layout, "components"), (navigation, "items"), (dock, "entries"), (dock, "desktop_icons")):
        if not isinstance(obj, dict):
            errors.append("Design sections must be objects")
            continue
        if key not in obj and key != "components":
            continue
        rows = obj.get(key)
        if not isinstance(rows, list) or len(rows) > 250:
            errors.append(key + " must be a list of at most 250 items")
            continue
        labels = set()
        previous_indent = -1
        for index, row in enumerate(rows):
            at = f"{key} item {index + 1}"
            if not isinstance(row, dict):
                errors.append(at + " must be an object")
                continue
            cfg = row.get("config", {}) if key == "components" else row
            if not isinstance(cfg, dict):
                errors.append(at + " config must be an object")
                continue
            if not strict:
                continue
            kind = row.get("type")
            title = row.get("title") if key in ("components", "entries") else row.get("label")
            link = key != "components" or kind == "shortcut"
            if key == "components":
                if kind not in COMPONENT_TYPES:
                    errors.append(at + ": unsupported component")
                selector = {"chart": "chart_name", "number_card": "number_card_name", "quick_list": "quick_list_name"}.get(kind)
                if selector and not str(cfg.get(selector) or "").strip():
                    errors.append(at + ": select " + selector)
                if "col" in cfg:
                    try:
                        width = float(cfg["col"])
                        if not width.is_integer() or not 1 <= width <= 12:
                            raise ValueError()
                    except (ValueError, TypeError):
                        errors.append(at + ": width must be 1–12")
            if link:
                if not str(title or "").strip():
                    errors.append(at + ": title required")
                target = cfg.get("link_to") or cfg.get("sidebar")
                if not str(target or "").strip():
                    errors.append(at + ": destination required")
                link_type = cfg.get("type" if key == "items" else "link_type", "DocType")
                if link_type not in LINK_TYPES:
                    errors.append(at + ": unsupported link type")
                if link_type in ("URL", "External") and target and not str(target).startswith(("https://", "http://", "/app/")):
                    errors.append(at + ": use an http(s) URL or /app/ route")
            if key == "desktop_icons" or key == "components" and kind == "shortcut":
                if title in labels:
                    errors.append(at + ": duplicate title")
                labels.add(title)
            if key == "items":
                try:
                    indent = int(row.get("indent") or 0)
                    if str(indent) != str(row.get("indent") or 0) or indent < 0 or indent > previous_indent + 1:
                        raise ValueError()
                    previous_indent = indent
                except (ValueError, TypeError):
                    errors.append(at + ": invalid nesting")
    return errors
