import { Setting, setIcon, setTooltip } from "obsidian";

export function addInfoIcon(setting: Setting, tooltip?: string): void {
    if (setting.nameEl.querySelector(".image-converter-setting-info-icon")) {
        return;
    }

    const settingDocument = setting.nameEl.doc ?? setting.nameEl.ownerDocument;
    const iconEl = settingDocument.createElement("span");
    iconEl.className = "image-converter-setting-info-icon";

    if (tooltip) {
        iconEl.setAttribute("aria-label", tooltip);
        setTooltip(iconEl, tooltip, {
            placement: "top",
            gap: 6,
        });
    } else {
        iconEl.setAttribute("aria-hidden", "true");
    }

    setIcon(iconEl, "info");
    setting.nameEl.appendChild(settingDocument.createTextNode(" "));
    setting.nameEl.appendChild(iconEl);
}
