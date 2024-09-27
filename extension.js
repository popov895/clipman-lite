'use strict';

const { Clutter, Cogl, Gio, GLib, GObject, Meta, Pango, Shell, Soup, St } = imports.gi;

const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const ModalDialog = imports.ui.modalDialog;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const SignalTracker = imports.misc.signalTracker;
const Util = imports.misc.util;

const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();
const { Preferences } = Extension.imports.lib.preferences;
const { QrCode } = Extension.imports.lib.qrcodegen.qrcodegen;
const { Storage } = Extension.imports.lib.storage;
const { _, logError } = Extension.imports.lib.utils;

const Clipboard = GObject.registerClass(
class Clipboard extends GObject.Object {
    static [GObject.GTypeName] = `ClipmanLite_Clipboard`;

    static [GObject.signals] = {
        'destroy': {},
        'changed': {},
    };

    constructor() {
        super();

        this._sensitiveMimeTypes = [
            `x-kde-passwordManagerHint`,
        ];

        this._clipboard = St.Clipboard.get_default();
        this._selection = global.get_display().get_selection();
        this._selection.connectObject(`owner-changed`, (...[, selectionType]) => {
            if (selectionType === Meta.SelectionType.SELECTION_CLIPBOARD) {
                this.emit(`changed`);
            }
        }, this);
    }

    destroy() {
        this.emit(`destroy`);
    }

    getText() {
        const mimeTypes = this._clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD);
        const hasSensitiveMimeType = mimeTypes.some((mimeType) => {
            return this._sensitiveMimeTypes.includes(mimeType);
        });
        if (hasSensitiveMimeType) {
            return Promise.resolve(null);
        }

        return new Promise((resolve) => {
            this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (...[, text]) => {
                resolve(text);
            });
        });
    }

    setText(text) {
        this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
    }

    clear() {
        this._clipboard.set_content(St.ClipboardType.CLIPBOARD, ``, GLib.Bytes.new(null));
    }
});

const HistoryMenuItem = GObject.registerClass(
class HistoryMenuItem extends PopupMenu.PopupSubMenuMenuItem {
    static [GObject.properties] = {
        'maxTextLength': GObject.ParamSpec.int(
            `maxTextLength`, ``, ``,
            GObject.ParamFlags.READWRITE,
            0, GLib.MAXINT32, 0
        ),
        'pinned': GObject.ParamSpec.boolean(
            `pinned`, ``, ``,
            GObject.ParamFlags.READWRITE,
            false
        ),
        'showBoundaryWhitespace': GObject.ParamSpec.boolean(
            `showBoundaryWhitespace`, ``, ``,
            GObject.ParamFlags.READWRITE,
            false
        ),
    };

    static [GObject.signals] = {
        'delete': {},
        'submenuAboutToOpen': {},
    };

    constructor(text) {
        super(``);

        this.text = text;
        this.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        const [ok, color] = this._parseColor(text.trim());
        if (ok) {
            this.insert_child_at_index(new St.Bin({
                opacity: color.alpha,
                style: `background: rgb(${color.red}, ${color.green}, ${color.blue});`,
                style_class: `clipman-colorpreview`,
                y_align: Clutter.ActorAlign.CENTER,
            }), 1);
        }

        this.setOrnament(PopupMenu.Ornament.NONE);

        this.menu.actor.enable_mouse_scrolling = false;
        this.menu._needsScrollbar = () => {
            return false;
        };
        this.menu.open = (animate) => {
            if (!this.menu.isOpen) {
                this.emit(`submenuAboutToOpen`);
                Object.getPrototypeOf(this.menu).open.call(this.menu, animate);
            }
        };

        this.add_child(new St.Bin({
            style_class: `popup-menu-item-expander`,
            x_expand: true,
        }));

        const pinButton = new St.Button({
            can_focus: true,
            child: new St.Icon({
                style_class: `popup-menu-icon`,
            }),
            style_class: `clipman-menuitembutton`,
        });
        this.bind_property_full(
            `pinned`,
            pinButton.child,
            `icon_name`,
            GObject.BindingFlags.DEFAULT | GObject.BindingFlags.SYNC_CREATE,
            (...[, pinned]) => {
                return [true, pinned ? `starred-symbolic` : `non-starred-symbolic`];
            },
            null
        );
        pinButton.connectObject(`clicked`, () => {
            this.togglePinned();
        });

        const deleteButton = new St.Button({
            can_focus: true,
            child: new St.Icon({
                icon_name: `edit-delete-symbolic`,
                style_class: `popup-menu-icon`,
            }),
            style_class: `clipman-menuitembutton`,
        });
        deleteButton.connectObject(`clicked`, () => {
            this.emit(`delete`);
        });

        this._triangleBin.hide();
        this._triangleBin.remove_child(this._triangle);

        const toggleSubMenuButton = new St.Button({
            can_focus: true,
            child: this._triangle,
            style_class: `clipman-menuitembutton`,
        });
        toggleSubMenuButton.connectObject(`clicked`, () => {
            this.menu.toggle();
        });

        const box = new St.BoxLayout({
            style_class: `clipman-menuitembuttonbox`,
        });
        box.add(pinButton);
        box.add(deleteButton);
        box.add(toggleSubMenuButton);
        this.add_child(box);

        const clickAction = new Clutter.ClickAction({
            enabled: this._activatable,
        });
        clickAction.connectObject(`clicked`, () => {
            this.activate(Clutter.get_current_event());
        });
        clickAction.connectObject(`notify::pressed`, () => {
            if (clickAction.pressed) {
                this.add_style_pseudo_class(`active`);
            } else {
                this.remove_style_pseudo_class(`active`);
            }
        });
        this.add_action(clickAction);

        this.connectObject(
            `notify::maxTextLength`, this._updateText.bind(this),
            `notify::showBoundaryWhitespace`, this._updateText.bind(this)
        );
    }

    get maxTextLength() {
        return this._maxTextLength ?? 0;
    }

    set maxTextLength(maxTextLength) {
        if (this._maxTextLength === maxTextLength) {
            return;
        }

        this._maxTextLength = maxTextLength;
        this.notify(`maxTextLength`);
    }

    get pinned() {
        return this._pinned ?? false;
    }

    set pinned(pinned) {
        if (this._pinned === pinned) {
            return;
        }

        this._pinned = pinned;
        this.notify(`pinned`);
    }

    get showBoundaryWhitespace() {
        return this._showBoundaryWhitespace ?? false;
    }

    set showBoundaryWhitespace(showBoundaryWhitespace) {
        if (this._showBoundaryWhitespace === showBoundaryWhitespace) {
            return;
        }

        this._showBoundaryWhitespace = showBoundaryWhitespace;
        this.notify(`showBoundaryWhitespace`);
    }

    _createTextFormatter(text) {
        return {
            text,
            markBoundaryWhitespace() {
                this.text = GLib.markup_escape_text(this.text, -1);
                this.text = this.text.replaceAll(/^\s+|\s+$/g, (match1) => {
                    [[/ +/g, `␣`], [/\t+/g, `⇥`], [/\n+/g, `↵`]].forEach(([regExp, str]) => {
                        match1 = match1.replaceAll(regExp, (match2) => {
                            return `<span alpha='35%'>${str.repeat(match2.length)}</span>`;
                        });
                    });
                    return match1;
                });
                return this;
            },
            shrinkWhitespace() {
                this.text = this.text.replaceAll(/\s+/g, ` `);
                return this;
            },
            trim() {
                this.text = this.text.trim();
                return this;
            },
            truncate(count) {
                if (this.text.length > count) {
                    this.text = this.text.substring(0, count - 1) + `…`;
                }
                return this;
            },
        };
    }

    _parseColor(text) {
        const colorSpaces = [
            {
                prefix: `rgba`,
                regExpList: [
                    /^rgba?\(\s*(\d{1,3}%?)\s*,\s*(\d{1,3}%?)\s*,\s*(\d{1,3}%?)(?:\s*,\s*(\d{1,3}%|0?.\d+))?\s*\)$/i,
                    /^rgba?\(\s*(\d{1,3}%?)\s+(\d{1,3}%?)\s+(\d{1,3}%?)(?:\s*?\/\s*?(\d{1,3}%|0?.\d+))?\s*\)$/i,
                ],
            },
            {
                prefix: `hsla`,
                regExpList: [
                    /^hsla?\(\s*(\d{1,3})\s*,\s*(\d{1,3}%)\s*,\s*(\d{1,3}%)(?:\s*,\s*(\d{1,3}%|0?.\d+))?\s*\)$/i,
                    /^hsla?\(\s*(\d{1,3})\s+(\d{1,3}%)\s+(\d{1,3}%)(?:\s*\/\s+(\d{1,3}%|0?.\d+))?\s*\)$/i,
                ],
            },
        ];

        for (const { prefix, regExpList } of colorSpaces) {
            for (const regExp of regExpList) {
                const match = text.match(regExp);
                if (match) {
                    let [, red, green, blue, alpha] = match;
                    if (alpha) {
                        const percentMatch = alpha.match(/(\d+)%/);
                        if (percentMatch) {
                            alpha = percentMatch[1] / 100;
                        }
                    }
                    return Clutter.Color.from_string(
                        `${prefix}(${red}, ${green}, ${blue}, ${alpha ?? 1})`
                    );
                }
            }
        }

        if (/^#[0-9a-f]{3,8}$/i.test(text) || /^[a-z]{3,}$/i.test(text)) {
            return Clutter.Color.from_string(text);
        }

        return [false, new Clutter.Color()];
    }

    _updateText() {
        if (this._showBoundaryWhitespace) {
            this.label.clutter_text.set_markup(
                this._createTextFormatter(this.text)
                    .truncate(this.maxTextLength)
                    .markBoundaryWhitespace()
                    .shrinkWhitespace()
                    .text
            );
        } else {
            this.label.set_text(
                this._createTextFormatter(this.text)
                    .trim()
                    .truncate(this.maxTextLength)
                    .shrinkWhitespace()
                    .text
            );
        }
    }

    activate(event) {
        this.emit(`activate`, event);
    }

    togglePinned() {
        this.pinned = !this.pinned;
    }

    vfunc_key_press_event(event) {
        switch (event.keyval) {
            case Clutter.KEY_space:
            case Clutter.KEY_Return:
            case Clutter.KEY_KP_Enter: {
                this.activate(Clutter.get_current_event());
                return Clutter.EVENT_STOP;
            }
            case Clutter.KEY_Delete:
            case Clutter.KEY_KP_Delete: {
                this.emit(`delete`);
                return Clutter.EVENT_STOP;
            }
            case Clutter.KEY_asterisk:
            case Clutter.KEY_KP_Multiply: {
                this.togglePinned();
                return Clutter.EVENT_STOP;
            }
            default:
                break;
        }

        return super.vfunc_key_press_event(event);
    }

    vfunc_button_press_event() {
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_button_release_event() {
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_touch_event() {
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_unmap() {
        super.vfunc_unmap();

        this.menu.close();
    }
});

const SearchEntry = GObject.registerClass(
class SearchEntry extends St.Entry {
    static [GObject.properties] = {
        'showPinnedOnly': GObject.ParamSpec.boolean(
            `showPinnedOnly`, ``, ``,
            GObject.ParamFlags.READWRITE,
            false
        ),
    };

    constructor(params) {
        super(params);

        this.secondary_icon = new St.Icon({
            style_class: `popup-menu-icon`,
        });
        this.bind_property_full(
            `showPinnedOnly`,
            this.secondary_icon,
            `icon_name`,
            GObject.BindingFlags.DEFAULT | GObject.BindingFlags.SYNC_CREATE,
            (...[, showPinnedOnly]) => {
                return [true, showPinnedOnly ? `starred-symbolic` : `non-starred-symbolic`];
            },
            null
        );

        this.connectObject(`secondary-icon-clicked`, () => {
            this.grab_key_focus();
            this.toggleShowPinnedOnly();
        });
    }

    get showPinnedOnly() {
        return this._showPinnedOnly ?? false;
    }

    set showPinnedOnly(showPinnedOnly) {
        if (this._showPinnedOnly === showPinnedOnly) {
            return;
        }

        this._showPinnedOnly = showPinnedOnly;
        this.notify(`showPinnedOnly`);
    }

    toggleShowPinnedOnly() {
        this.showPinnedOnly = !this.showPinnedOnly;
    }

    vfunc_enter_event(event) {
        this.grab_key_focus();

        return super.vfunc_enter_event(event);
    }
});

const HistoryMenuSection = class extends PopupMenu.PopupMenuSection {
    constructor() {
        super();

        this.entry = new SearchEntry({
            can_focus: true,
            hint_text: _(`Type to search...`),
            style_class: `clipman-searchentry`,
            x_expand: true,
        });
        this.entry.connectObject(
            `notify::showPinnedOnly`, this._filterMenuItems.bind(this),
            `notify::text`, this._filterMenuItems.bind(this)
        );
        const searchMenuItem = new PopupMenu.PopupBaseMenuItem({
            can_focus: false,
            reactive: false,
            style_class: `clipman-searchmenuitem`,
        });
        searchMenuItem.setOrnament(PopupMenu.Ornament.HIDDEN);
        searchMenuItem.add(this.entry);
        this.addMenuItem(searchMenuItem);

        const placeholderLabel = new St.Label({
            text: _(`No Matches`),
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._placeholderMenuItem = new PopupMenu.PopupMenuSection();
        this._placeholderMenuItem.actor.style_class = `popup-menu-item`;
        this._placeholderMenuItem.actor.visible = false;
        this._placeholderMenuItem.actor.add(placeholderLabel);
        this.addMenuItem(this._placeholderMenuItem);

        this.section = new PopupMenu.PopupMenuSection();
        this.section.moveMenuItem = (menuItem, position) => {
            Object.getPrototypeOf(this.section).moveMenuItem.call(this.section, menuItem, position);
            if (menuItem instanceof HistoryMenuItem) {
                this.section.box.set_child_above_sibling(menuItem.menu.actor, menuItem);
            }
        };
        this.section.box.connectObject(
            `actor-added`, (...[, actor]) => {
                if (actor instanceof HistoryMenuItem) {
                    this._onMenuItemAdded(actor);
                }
            },
            `actor-removed`, (...[, actor]) => {
                if (actor instanceof HistoryMenuItem) {
                    this._onMenuItemRemoved(actor);
                }
            }
        );
        this.scrollView = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.EXTERNAL,
        });
        this.scrollView.add_actor(this.section.actor);
        this.scrollView.vscroll.adjustment.connectObject(`changed`, () => {
            Promise.resolve().then(() => {
                if (Math.floor(this.scrollView.vscroll.adjustment.upper) > this.scrollView.vscroll.adjustment.page_size) {
                    this.scrollView.vscrollbar_policy = St.PolicyType.ALWAYS;
                } else {
                    this.scrollView.vscrollbar_policy = St.PolicyType.EXTERNAL;
                }
            });
        });
        const menuSection = new PopupMenu.PopupMenuSection();
        menuSection.actor.add_actor(this.scrollView);
        this.addMenuItem(menuSection);

        this.actor.connectObject(`notify::mapped`, () => {
            if (!this.actor.mapped) {
                this.scrollView.vscroll.adjustment.value = 0;
                this.entry.showPinnedOnly = false;
                this.entry.text = ``;
            }
        });
    }

    _setParent(parent) {
        super._setParent(parent);

        this.section._setParent(parent);
    }

    _createFilter() {
        return {
            pinnedOnly: this.entry.showPinnedOnly,
            text: this.entry.text.toLowerCase(),
            isActive() {
                return this.pinnedOnly || this.text.length > 0;
            },
            apply(menuItem) {
                menuItem.actor.visible = (!this.pinnedOnly || menuItem.pinned) && menuItem.text.toLowerCase().includes(this.text);
            },
        };
    }

    _filterMenuItems() {
        const filter = this._createFilter();
        this.section._getMenuItems().forEach(filter.apply, filter);
        if (!filter.isActive()) {
            this._placeholderMenuItem.actor.visible = false;
        } else {
            this._placeholderMenuItem.actor.visible = this.section.isEmpty();
        }
    }

    _onMenuItemAdded(menuItem) {
        const filter = this._createFilter();
        if (filter.isActive()) {
            filter.apply(menuItem);
            if (menuItem.actor.visible) {
                this._placeholderMenuItem.actor.visible = false;
            }
        }

        menuItem.connectObject(
            `key-focus-in`, () => {
                const event = Clutter.get_current_event();
                if (event && event.type() === Clutter.EventType.KEY_PRESS) {
                    Util.ensureActorVisibleInScrollView(this.scrollView, menuItem);
                }
            },
            `notify::pinned`, this._onMenuItemPinned.bind(this)
        );
    }

    _onMenuItemRemoved() {
        if (this._createFilter().isActive()) {
            this._placeholderMenuItem.actor.visible = this.section.isEmpty();
        }
    }

    _onMenuItemPinned(menuItem) {
        const filter = this._createFilter();
        if (filter.isActive()) {
            filter.apply(menuItem);
            if (menuItem.actor.visible) {
                this._placeholderMenuItem.actor.visible = false;
            } else {
                this._placeholderMenuItem.actor.visible = this.section.isEmpty();
            }
        }
    }
};

const PlaceholderMenuItem = class extends PopupMenu.PopupMenuSection {
    constructor(text, icon) {
        super();

        this.actor.style_class = `popup-menu-item`;

        const box = new St.BoxLayout({
            style_class: `clipman-placeholdermenuitembox`,
            vertical: true,
        });
        box.add_child(new St.Icon({
            gicon: icon,
            x_align: Clutter.ActorAlign.CENTER,
        }));
        box.add_child(new St.Label({
            text: text,
            x_align: Clutter.ActorAlign.CENTER,
        }));
        this.actor.add(box);
    }
};

const QrCodeDialog = GObject.registerClass(
class QrCodeDialog extends ModalDialog.ModalDialog {
    constructor(text) {
        super();

        const image = this._generateQrCodeImage(text);
        if (image) {
            this.contentLayout.add_child(new St.Icon({
                gicon: image,
                icon_size: image.preferred_width,
            }));
        } else {
            this.contentLayout.add_child(new St.Label({
                text: _(`Failed to generate QR code`),
            }));
        }

        this.addButton({
            key: Clutter.KEY_Escape,
            label: _(`Close`, `Close dialog`),
            action: () => {
                this.close();
            },
        });
    }

    _generateQrCodeImage(text) {
        let image;
        try {
            const bytesPerPixel = 3; // RGB
            const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const minPixelsPerModule = 3;
            const maxPixelsPerModule = 10;
            const maxQuietZoneSize = 4 * maxPixelsPerModule;
            const maxIconSize = Math.round(Math.min(global.screen_width, global.screen_height) * 0.9 / scaleFactor);
            const qrCode = QrCode.encodeText(text, QrCode.Ecc.MEDIUM);
            const pixelsPerModule = Math.min(
                Math.round((maxIconSize - 2 * maxQuietZoneSize) / qrCode.size),
                maxPixelsPerModule
            );
            if (pixelsPerModule < minPixelsPerModule) {
                throw new Error(`QR code is too large`);
            }
            const quietZoneSize = Math.min(4 * pixelsPerModule, maxQuietZoneSize);
            const iconSize = qrCode.size * pixelsPerModule + 2 * quietZoneSize;
            const data = new Uint8Array(iconSize * iconSize * pixelsPerModule * bytesPerPixel);
            data.fill(255);
            for (let qrCodeY = 0; qrCodeY < qrCode.size; ++qrCodeY) {
                for (let i = 0; i < pixelsPerModule; ++i) {
                    const dataY = quietZoneSize + qrCodeY * pixelsPerModule + i;
                    for (let qrCodeX = 0; qrCodeX < qrCode.size; ++qrCodeX) {
                        const color = qrCode.getModule(qrCodeX, qrCodeY) ? 0x00 : 0xff;
                        for (let j = 0; j < pixelsPerModule; ++j) {
                            const dataX = quietZoneSize + qrCodeX * pixelsPerModule + j;
                            const dataI = iconSize * bytesPerPixel * dataY + bytesPerPixel * dataX;
                            data[dataI] = color;     // R
                            data[dataI + 1] = color; // G
                            data[dataI + 2] = color; // B
                        }
                    }
                }
            }

            image = new St.ImageContent({
                preferred_height: iconSize,
                preferred_width: iconSize,
            });
            image.set_bytes(
                new GLib.Bytes(data),
                Cogl.PixelFormat.RGB_888,
                iconSize,
                iconSize,
                iconSize * bytesPerPixel
            );
        } catch (error) {
            logError(`Failed to generate QR code`, error);
        }

        return image;
    }
});

const PanelIndicator = GObject.registerClass(
class PanelIndicator extends PanelMenu.Button {
    constructor(extension) {
        super(0.5);

        this._extension = extension;

        this._buildIcon();
        this._buildMenu();

        this._clipboard = new Clipboard();
        this._clipboard.connectObject(`changed`, () => {
            if (!this._privateModeMenuItem.state) {
                this._clipboard.getText().then((text) => {
                    this._onClipboardTextChanged(text);
                });
            }
        });

        this._preferences = new Preferences();
        this._preferences.connectObject(`notify::historySize`, this._onHistorySizeChanged.bind(this));

        this._storage = new Storage();

        this._addKeybindings();
        this._loadState();
        this._updateMenuLayout();
    }

    destroy() {
        this._modalDialog?.close();

        this._removeKeybindings();
        this._saveState();

        this._clipboard.destroy();
        this._preferences.destroy();

        super.destroy();
    }

    _buildIcon() {
        this._mainIcon = new St.Icon({
            icon_name: `edit-paste-symbolic`,
            style_class: `system-status-icon`,
        });
        this.add_child(this._mainIcon);
    }

    _buildMenu() {
        this._emptyPlaceholder = new PlaceholderMenuItem(
            _(`History is Empty`),
            Gio.icon_new_for_string(`${Extension.path}/icons/empty-symbolic.svg`)
        );
        this.menu.addMenuItem(this._emptyPlaceholder);

        this._privateModePlaceholder = new PlaceholderMenuItem(
            _(`Private Mode is On`),
            Gio.icon_new_for_string(`${Extension.path}/icons/private-mode-symbolic.svg`)
        );
        this.menu.addMenuItem(this._privateModePlaceholder);

        this._historySection = new HistoryMenuSection();
        this._historySection.section.box.connectObject(
            `actor-added`, (...[, actor]) => {
                if (actor instanceof HistoryMenuItem) {
                    this._updateMenuLayout();
                }
            },
            `actor-removed`, (...[, actor]) => {
                if (actor instanceof HistoryMenuItem) {
                    this._updateMenuLayout();
                }
            }
        );
        this.menu.addMenuItem(this._historySection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._clearMenuItem = new PopupMenu.PopupMenuItem(_(`Clear History`));
        this._clearMenuItem.activate = () => {
            this.menu.close();
            this._getMenuItems().getNotPinned().erase();
        };
        this.menu.addMenuItem(this._clearMenuItem);

        this._privateModeMenuItem = new PopupMenu.PopupSwitchMenuItem(_(`Private Mode`), false);
        this._privateModeMenuItem._switch.bind_property_full(
            `state`,
            this._mainIcon,
            `opacity`,
            GObject.BindingFlags.DEFAULT | GObject.BindingFlags.SYNC_CREATE,
            (...[, state]) => {
                return [true, state ? 255 / 2 : 255];
            },
            null
        );
        this._privateModeMenuItem.connectObject(`toggled`, (...[, state]) => {
            this.menu.close();
            if (!state) {
                this._updateCurrentMenuItem();
            }
            this._updateMenuLayout();
        });
        this.menu.addMenuItem(this._privateModeMenuItem);

        this.menu.addAction(_(`Settings`, `Open settings`), () => {
            ExtensionUtils.openPrefs();
        });

        this.menu.actor.connectObject(`captured-event`, (...[, event]) => {
            if (event.type() === Clutter.EventType.KEY_PRESS) {
                return this._onMenuKeyPressEvent(event);
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _getMenuItems() {
        const menuItems = this._historySection.section._getMenuItems();
        menuItems.findByText = (text) => {
            return menuItems.find((menuItem) => {
                return menuItem.text === text;
            });
        };
        menuItems.getNotPinned = () => {
            const notPinnedMenuItems = menuItems.filter((menuItem) => {
                return !menuItem.pinned;
            });
            notPinnedMenuItems.erase = (start = 0, count = Infinity) => {
                notPinnedMenuItems.splice(start, count).forEach(this._destroyMenuItem, this);
            };
            return notPinnedMenuItems;
        };
        menuItems.getPinned = () => {
            return menuItems.filter((menuItem) => {
                return menuItem.pinned;
            });
        };
        menuItems.isLast = (menuItem) => {
            return menuItems.length > 0 && menuItems[menuItems.length - 1] === menuItem;
        };

        return menuItems;
    }

    _createMenuItem(text, pinned = false, id = GLib.uuid_string_random()) {
        const menuItem = new HistoryMenuItem(text);
        menuItem.id = id;
        menuItem.pinned = pinned;
        this._preferences.bind_property(
            `showBoundaryWhitespace`,
            menuItem,
            `showBoundaryWhitespace`,
            GObject.BindingFlags.DEFAULT | GObject.BindingFlags.SYNC_CREATE
        );
        menuItem.connectObject(
            `activate`, () => {
                this.menu.close();
                this._clipboard.setText(menuItem.text);
            },
            `notify::pinned`, this._onMenuItemPinned.bind(this),
            `submenuAboutToOpen`, this._ensureSubMenuPopulated.bind(this),
            `delete`, () => {
                if (this._getMenuItems().length === 1) {
                    this.menu.close();
                }
                this._destroyMenuItem(menuItem);
                if (menuItem.pinned) {
                    this._storage.saveEntries(this._getMenuItems().getPinned());
                }
            },
            `destroy`, () => {
                if (this._currentMenuItem === menuItem) {
                    delete this._currentMenuItem;
                }
            }
        );

        return menuItem;
    }

    _destroyMenuItem(menuItem) {
        if (this._currentMenuItem === menuItem) {
            this._clipboard.clear();
        }

        if (menuItem.has_key_focus()) {
            const menuItems = this._getMenuItems();
            if (menuItems.length > 1) {
                menuItem.get_parent().navigate_focus(
                    menuItem,
                    menuItems.isLast(menuItem) ? St.DirectionType.UP : St.DirectionType.DOWN,
                    false
                );
            }
        }

        menuItem.destroy();

        if (menuItem.pinned) {
            this._storage.deleteEntryContent(menuItem);
        }
    }

    _updateCurrentMenuItem() {
        this._clipboard.getText().then((text) => {
            let currentMenuItem;
            if (text && text.length > 0) {
                const menuItems = this._getMenuItems();
                currentMenuItem = menuItems.findByText(text);
                if (currentMenuItem && menuItems[0] !== currentMenuItem) {
                    this._historySection.section.moveMenuItem(currentMenuItem, 0);
                    if (currentMenuItem.pinned) {
                        this._storage.saveEntries(this._getMenuItems().getPinned());
                    }
                }
            }

            if (this._currentMenuItem !== currentMenuItem) {
                this._currentMenuItem?.setOrnament(PopupMenu.Ornament.NONE);
                this._currentMenuItem = currentMenuItem;
                this._currentMenuItem?.setOrnament(PopupMenu.Ornament.DOT);
            }
        });
    }

    _updateMenuLayout() {
        const privateMode = this._privateModeMenuItem.state;
        this._privateModePlaceholder.actor.visible = privateMode;

        const menuItems = this._getMenuItems();
        this._emptyPlaceholder.actor.visible = !privateMode && menuItems.length === 0;
        this._historySection.actor.visible = !privateMode && menuItems.length > 0;
        this._clearMenuItem.actor.visible = !privateMode && menuItems.getNotPinned().length > 0;
    }

    _updateMenuMinMaxSize() {
        const workArea = Main.layoutManager.getWorkAreaForMonitor(
            Main.layoutManager.findIndexForActor(this.menu.actor)
        );
        const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const minAvailableSize = Math.min(workArea.width, workArea.height) / scaleFactor;

        const [menuMaxWidth, menuMaxHeight] = [
            Math.round(minAvailableSize * 0.6),
            Math.round(minAvailableSize * 0.7),
        ];
        this.menu.actor.style = `max-width: ${menuMaxWidth}px; max-height: ${menuMaxHeight}px;`;

        const entryMinWidth = Math.min(300, Math.round(menuMaxWidth * 0.75));
        this._historySection.entry.style = `min-width: ${entryMinWidth}px;`;

        this._getMenuItems().forEach((menuItem) => {
            menuItem.maxTextLength = menuMaxWidth;
        });
    }

    _addKeybindings() {
        Main.wm.addKeybinding(
            this._preferences._keyToggleMenuShortcut,
            this._preferences._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => {
                this.menu.toggle();
            }
        );
        Main.wm.addKeybinding(
            this._preferences._keyTogglePrivateModeShortcut,
            this._preferences._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => {
                this._privateModeMenuItem.toggle();
            }
        );
        Main.wm.addKeybinding(
            this._preferences._keyClearHistoryShortcut,
            this._preferences._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => {
                if (this._clearMenuItem.actor.visible) {
                    this._clearMenuItem.activate(Clutter.get_current_event());
                }
            }
        );
    }

    _removeKeybindings() {
        Main.wm.removeKeybinding(this._preferences._keyToggleMenuShortcut);
        Main.wm.removeKeybinding(this._preferences._keyTogglePrivateModeShortcut);
        Main.wm.removeKeybinding(this._preferences._keyClearHistoryShortcut);
    }

    _loadHistory() {
        const entries = this._storage.loadEntries();
        if (entries.length === 0) {
            return;
        }

        entries.forEach((entry) => {
            if (!entry.id) {
                return;
            }

            this._storage.loadEntryContent(entry);
            if (!entry.text) {
                return;
            }

            this._historySection.section.addMenuItem(
                this._createMenuItem(entry.text, true, entry.id)
            );
        });

        if (!this._privateModeMenuItem.state) {
            this._updateCurrentMenuItem();
        }
    }

    _loadState() {
        if (!this._extension._state) {
            this._loadHistory();
        } else {
            this._privateModeMenuItem.setToggleState(this._extension._state.privateMode);

            if (this._extension._state.history.length > 0) {
                this._extension._state.history.forEach((entry) => {
                    this._historySection.section.addMenuItem(
                        this._createMenuItem(entry.text, entry.pinned, entry.id)
                    );
                });
                this._extension._state.history.length = 0;

                if (!this._privateModeMenuItem.state) {
                    this._updateCurrentMenuItem();
                }
            }
        }
    }

    _saveState() {
        if (Main.sessionMode.currentMode !== `unlock-dialog`) {
            delete this._extension._state;
        } else {
            this._extension._state = {
                privateMode: this._privateModeMenuItem.state,
                history: this._getMenuItems().map((menuItem) => {
                    return {
                        id: menuItem.id,
                        text: menuItem.text,
                        pinned: menuItem.pinned,
                    };
                }),
            };
        }
    }

    _ensureSubMenuPopulated(menuItem) {
        if (menuItem.menu.numMenuItems > 0) {
            return;
        }

        menuItem.menu.addAction(_(`Search the Web`), () => {
            this._searchTheWeb(menuItem.text);
        });

        menuItem.menu.addAction(_(`Share Online`), () => {
            this._shareOnline(menuItem.text);
        });

        menuItem.menu.addAction(_(`Show QR Code`), () => {
            this._showQrCode(menuItem.text);
        });
    }

    _searchTheWeb(text) {
        try {
            const webSearchUrl = this._preferences.webSearchUrl;
            if (!webSearchUrl.includes(`%s`)) {
                throw new Error(_(`Invalid search URL "%s"`).format(webSearchUrl));
            }
            Gio.app_info_launch_default_for_uri(
                webSearchUrl.replace(`%s`, encodeURIComponent(text)),
                global.create_app_launch_context(0, -1)
            );
        } catch (error) {
            Main.notifyError(_(`Failed to search the web`), error.message);
        }
    }

    _shareOnline(text) {
        const message = Soup.Message.new(`POST`, `https://dpaste.com/api/v2/`);
        message.set_request_body_from_bytes(
            Soup.FORM_MIME_TYPE_URLENCODED,
            GLib.Bytes.new(Soup.form_encode_hash({
                content: text,
                expiry_days: this._preferences.expiryDays.toString(),
            }))
        );

        if (!this._soupSession) {
            this._soupSession = new Soup.Session({
                user_agent: Extension.uuid,
            });
            if (Soup.get_major_version() < 3) {
                this._soupSession.send_and_read_finish = (message) => {
                    return message.response_body.flatten().get_as_bytes();
                };
            }
        }

        this._soupSession.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (...[, result]) => {
                try {
                    if (message.status_code !== Soup.Status.CREATED) {
                        throw new Error(message.reason_phrase);
                    }
                    const uri = new TextDecoder().decode(
                        this._soupSession
                            .send_and_read_finish(result)
                            .get_data()
                    ).trim();
                    if (this._extension._indicator && !this._privateModeMenuItem.state) {
                        this._clipboard.setText(uri);
                    }
                    this._showNotification(_(`The text was successfully shared online`), uri, false);
                } catch (error) {
                    this._showNotification(_(`Failed to share the text online`), error.message);
                }
            }
        );
    }

    _showQrCode(text) {
        this._modalDialog = new QrCodeDialog(text);
        this._modalDialog.connectObject(`destroy`, () => {
            delete this._modalDialog;
        });
        this._modalDialog.open();
    }

    _showNotification(message, details, isTransient = true) {
        if (!this._notificationSource) {
            this._notificationSource = new MessageTray.SystemNotificationSource();
            this._notificationSource.connectObject(`destroy`, () => {
                delete this._notificationSource;
            });
            Main.messageTray.add(this._notificationSource);
        }

        const notification = new MessageTray.Notification(
            this._notificationSource,
            message,
            details
        );
        notification.setTransient(isTransient);
        this._notificationSource.showNotification(notification);
    }

    _onClipboardTextChanged(text) {
        let currentMenuItem;
        if (text && text.length > 0) {
            const menuItems = this._getMenuItems();
            currentMenuItem = menuItems.findByText(text);
            if (currentMenuItem) {
                if (menuItems[0] !== currentMenuItem) {
                    this._historySection.section.moveMenuItem(currentMenuItem, 0);
                    if (currentMenuItem.pinned) {
                        this._storage.saveEntries(this._getMenuItems().getPinned());
                    }
                }
            } else {
                menuItems.getNotPinned().erase(this._preferences.historySize - 1);
                currentMenuItem = this._createMenuItem(text);
                this._historySection.section.addMenuItem(currentMenuItem, 0);
            }
        }

        if (this._currentMenuItem !== currentMenuItem) {
            this._currentMenuItem?.setOrnament(PopupMenu.Ornament.NONE);
            this._currentMenuItem = currentMenuItem;
            this._currentMenuItem?.setOrnament(PopupMenu.Ornament.DOT);
        }
    }

    _onHistorySizeChanged() {
        this._getMenuItems().getNotPinned().erase(this._preferences.historySize);
    }

    _onMenuItemPinned(menuItem) {
        if (menuItem.pinned) {
            this._storage.saveEntryContent(menuItem);
        } else {
            this._getMenuItems().getNotPinned().erase(this._preferences.historySize);
            this._storage.deleteEntryContent(menuItem);
        }

        this._updateMenuLayout();

        this._storage.saveEntries(this._getMenuItems().getPinned());
    }

    _onMenuKeyPressEvent(event) {
        switch (event.get_key_symbol()) {
            case Clutter.KEY_Escape: {
                if (this._historySection.entry.clutter_text.has_key_focus() && this._historySection.entry.text.length > 0) {
                    this._historySection.entry.text = ``;
                    return Clutter.EVENT_STOP;
                }
                break;
            }
            case Clutter.KEY_slash: {
                if (this._historySection.actor.visible) {
                    this._historySection.entry.grab_key_focus();
                    this._historySection.entry.clutter_text.set_selection(-1, 0);
                    return Clutter.EVENT_STOP;
                }
                break;
            }
            case Clutter.KEY_asterisk:
            case Clutter.KEY_KP_Multiply: {
                if ((event.get_state() & Clutter.ModifierType.CONTROL_MASK) && this._historySection.entry.mapped) {
                    this._historySection.entry.grab_key_focus();
                    this._historySection.entry.toggleShowPinnedOnly();
                    return Clutter.EVENT_STOP;
                }
                break;
            }
            default:
                break;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onOpenStateChanged(...[, open]) {
        if (open) {
            this.add_style_pseudo_class(`active`);

            Promise.resolve().then(() => {
                this._historySection.entry.grab_key_focus();
            });

            this._updateMenuMinMaxSize();
        } else {
            this.remove_style_pseudo_class(`active`);
        }
    }
});

class ExtensionImpl {
    static {
        SignalTracker.registerDestroyableType(Clipboard);
        SignalTracker.registerDestroyableType(Preferences);

        ExtensionUtils.initTranslations(Extension.uuid);
    }

    enable() {
        this._indicator = new PanelIndicator(this);
        Main.panel.addToStatusArea(`${Extension.metadata.name}`, this._indicator);
    }

    disable() {
        this._indicator.destroy();
        delete this._indicator;
    }
}

var init = () => {
    return new ExtensionImpl();
};
