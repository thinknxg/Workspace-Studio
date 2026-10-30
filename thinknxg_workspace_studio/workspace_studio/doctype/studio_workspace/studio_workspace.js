// The design itself is edited only in the visual designer; the stored JSON fields are hidden.
frappe.ui.form.on('Studio Workspace', {
    refresh(frm) {
        if (frm.is_new()) return;
        frm.add_custom_button(__('Open in Workspace Studio'), () => {
            frappe.route_options = {design: frm.doc.name};
            frappe.set_route('workspace-studio');
        }).addClass('btn-primary');
        frm.set_intro(__('Layout, Sidebar, Dock and Desktop Icons are designed visually in Workspace Studio.'), 'blue');
    }
});
