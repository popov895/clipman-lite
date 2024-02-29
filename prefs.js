'use strict';

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { Preferences } from './lib/preferences.js';
import { _ } from './lib/utils.js';

const ShortcutWindow = GObject.registerClass(
class ShortcutWindow extends Adw.Window {
    static [GObject.signals] = {
        'shortcut': {
            param_types: [GObject.TYPE_STRING],
        },
    };

    constructor(parent) {
        super({
            content: new Adw.StatusPage({
                description: _(`Press Backspace to clear shortcut or Esc to cancel`),
                title: _(`Enter a new shortcut`),
            }),
            modal: true,
            resizable: false,
            transient_for: parent,
            width_request: 450,
        });

        const keyController = new Gtk.EventControllerKey();
        keyController.connect(`key-pressed`, (...[, keyval, keycode, state]) => {
            switch (keyval) {
                case Gdk.KEY_Escape: {
                    this.close();
                    return Gdk.EVENT_STOP;
                }
                case Gdk.KEY_BackSpace: {
                    this.emit(`shortcut`, ``);
                    return Gdk.EVENT_STOP;
                }
                default: {
                    const mask = state & Gtk.accelerator_get_default_mod_mask();
                    if (mask && Gtk.accelerator_valid(keyval, mask)) {
                        const shortcut = Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask);
                        if (shortcut.length > 0) {
                            this.emit(`shortcut`, shortcut);
                            return Gdk.EVENT_STOP;
                        }
                    }
                    break;
                }
            }
            return Gdk.EVENT_PROPAGATE;
        });
        this.add_controller(keyController);
    }
});

const ShortcutRow = GObject.registerClass(
class ShortcutRow extends Adw.ActionRow {
    constructor(title, preferences, property) {
        super({
            title: title,
        });

        this._preferences = preferences;
        this._property = property;

        this.activatable_widget = new Gtk.ShortcutLabel({
            disabled_text: _(`Disabled`, `Keyboard shortcut is disabled`),
            valign: Gtk.Align.CENTER,
        });
        this._preferences.bind_property(
            this._property,
            this.activatable_widget,
            `accelerator`,
            GObject.BindingFlags.DEFAULT | GObject.BindingFlags.SYNC_CREATE
        );
        this.add_suffix(this.activatable_widget);
    }

    vfunc_activate() {
        const window = new ShortcutWindow(this.get_root());
        window.connect(`shortcut`, (...[, shortcut]) => {
            this._preferences.set_property(this._property, shortcut);
            window.close();
        });
        window.connect(`close-request`, () => {
            window.destroy();
        });
        window.present();
    }
});

export default class extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window._preferences = new Preferences(this);
        window.connect(`close-request`, () => {
            window._preferences.destroy();
        });

        const historySizeSpinBox = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 500,
                step_increment: 1,
            }),
            valign: Gtk.Align.CENTER,
        });
        window._preferences.bind_property(
            `historySize`,
            historySizeSpinBox,
            `value`,
            GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE
        );

        const historySizeRow = new Adw.ActionRow({
            activatable_widget: historySizeSpinBox,
            title: _(`History size`),
        });
        historySizeRow.add_suffix(historySizeSpinBox);

        const boundaryWhitespaceSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        window._preferences.bind_property(
            `showBoundaryWhitespace`,
            boundaryWhitespaceSwitch,
            `active`,
            GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE
        );

        const boundaryWhitespaceRow = new Adw.ActionRow({
            activatable_widget: boundaryWhitespaceSwitch,
            title: _(`Show leading and trailing whitespace`),
        });
        boundaryWhitespaceRow.add_suffix(boundaryWhitespaceSwitch);

        const generalGroup = new Adw.PreferencesGroup({
            title: _(`General`, `General options`),
        });
        generalGroup.add(historySizeRow);
        generalGroup.add(boundaryWhitespaceRow);

        const webSearchUrlEntry = new Gtk.Entry({
            placeholder_text: _(`URL with %s in place of query`),
            valign: Gtk.Align.CENTER,
        });
        webSearchUrlEntry.set_size_request(300, -1);
        window._preferences.bind_property(
            `webSearchUrl`,
            webSearchUrlEntry,
            `text`,
            GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE
        );

        const webSearchUrlRow = new Adw.ActionRow({
            activatable_widget: webSearchUrlEntry,
            title: _(`Search URL`),
        });
        webSearchUrlRow.add_suffix(webSearchUrlEntry);

        const webSearchGroup = new Adw.PreferencesGroup({
            title: _(`Web Search`),
        });
        webSearchGroup.add(webSearchUrlRow);

        const expiryDaysSpinBox = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 365,
                step_increment: 1,
            }),
            valign: Gtk.Align.CENTER,
        });
        window._preferences.bind_property(
            `expiryDays`,
            expiryDaysSpinBox,
            `value`,
            GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE
        );

        const expiryDaysRow = new Adw.ActionRow({
            activatable_widget: expiryDaysSpinBox,
            title: _(`Days to keep`, `The number of days to keep the shared text`),
        });
        expiryDaysRow.add_suffix(expiryDaysSpinBox);

        const sharingOnlineGroup = new Adw.PreferencesGroup({
            title: _(`Sharing Online`),
        });
        sharingOnlineGroup.add(expiryDaysRow);

        const keybindingGroup = new Adw.PreferencesGroup({
            title: _(`Keyboard Shortcuts`),
        });
        keybindingGroup.add(new ShortcutRow(
            _(`Toggle menu`),
            window._preferences,
            `toggleMenuShortcut`
        ));
        keybindingGroup.add(new ShortcutRow(
            _(`Toggle private mode`),
            window._preferences,
            `togglePrivateModeShortcut`
        ));
        keybindingGroup.add(new ShortcutRow(
            _(`Clear history`),
            window._preferences,
            `clearHistoryShortcut`
        ));

        const page = new Adw.PreferencesPage();
        page.add(generalGroup);
        page.add(webSearchGroup);
        page.add(sharingOnlineGroup);
        page.add(keybindingGroup);

        window.add(page);
    }
}
