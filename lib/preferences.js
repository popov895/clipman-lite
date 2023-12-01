'use strict';

const { GObject } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;

var Preferences = GObject.registerClass(
class Preferences extends GObject.Object {
    static [GObject.GTypeName] = `ClipmanLite_Preferences`;

    static [GObject.properties] = {
        'historySize': GObject.ParamSpec.int(
            `historySize`, ``, ``,
            GObject.ParamFlags.READWRITE,
            1, 500, 15
        ),
        'showBoundaryWhitespace': GObject.ParamSpec.boolean(
            `showBoundaryWhitespace`, ``, ``,
            GObject.ParamFlags.READWRITE,
            true
        ),
        'webSearchUrl': GObject.ParamSpec.string(
            `webSearchUrl`, ``, ``,
            GObject.ParamFlags.READWRITE,
            ``
        ),
        'expiryDays': GObject.ParamSpec.int(
            `expiryDays`, ``, ``,
            GObject.ParamFlags.READWRITE,
            1, 365, 7
        ),
        'toggleMenuShortcut': GObject.ParamSpec.string(
            `toggleMenuShortcut`, ``, ``,
            GObject.ParamFlags.READWRITE,
            `<Super>Z`
        ),
        'togglePrivateModeShortcut': GObject.ParamSpec.string(
            `togglePrivateModeShortcut`, ``, ``,
            GObject.ParamFlags.READWRITE,
            ``
        ),
        'clearHistoryShortcut': GObject.ParamSpec.string(
            `clearHistoryShortcut`, ``, ``,
            GObject.ParamFlags.READWRITE,
            ``
        ),
    };

    static [GObject.signals] = {
        'destroy': {},
    };

    constructor() {
        super();

        this._keyHistorySize = `history-size`;
        this._keyShowBoundaryWhitespace = `show-boundary-whitespace`;
        this._keyWebSearchUrl = `web-search-url`;
        this._keyExpiryDays = `expiry-days`;
        this._keyToggleMenuShortcut = `toggle-menu-shortcut`;
        this._keyTogglePrivateModeShortcut = `toggle-private-mode-shortcut`;
        this._keyClearHistoryShortcut = `clear-history-shortcut`;

        this._settings = ExtensionUtils.getSettings();
        this._settingsChangedHandlerId = this._settings.connect(`changed`, (...[, key]) => {
            switch (key) {
                case this._keyHistorySize: {
                    this.notify(`historySize`);
                    break;
                }
                case this._keyShowBoundaryWhitespace: {
                    this.notify(`showBoundaryWhitespace`);
                    break;
                }
                case this._keyWebSearchUrl: {
                    this.notify(`webSearchUrl`);
                    break;
                }
                case this._keyExpiryDays: {
                    this.notify(`expiryDays`);
                    break;
                }
                case this._keyToggleMenuShortcut: {
                    this.notify(`toggleMenuShortcut`);
                    break;
                }
                case this._keyTogglePrivateModeShortcut: {
                    this.notify(`togglePrivateModeShortcut`);
                    break;
                }
                case this._keyClearHistoryShortcut: {
                    this.notify(`clearHistoryShortcut`);
                    break;
                }
                default:
                    break;
            }
        });
    }

    destroy() {
        this._settings.disconnect(this._settingsChangedHandlerId);

        this.emit(`destroy`);
    }

    get historySize() {
        return this._settings.get_int(this._keyHistorySize);
    }

    set historySize(historySize) {
        this._settings.set_int(this._keyHistorySize, historySize);
    }

    get showBoundaryWhitespace() {
        return this._settings.get_boolean(this._keyShowBoundaryWhitespace);
    }

    set showBoundaryWhitespace(showBoundaryWhitespace) {
        this._settings.set_boolean(this._keyShowBoundaryWhitespace, showBoundaryWhitespace);
    }

    get webSearchUrl() {
        return this._settings.get_string(this._keyWebSearchUrl);
    }

    set webSearchUrl(webSearchUrl) {
        this._settings.set_string(this._keyWebSearchUrl, webSearchUrl);
    }

    get expiryDays() {
        return this._settings.get_int(this._keyExpiryDays);
    }

    set expiryDays(expiryDays) {
        this._settings.set_int(this._keyExpiryDays, expiryDays);
    }

    get toggleMenuShortcut() {
        return this._getShortcut(this._keyToggleMenuShortcut);
    }

    set toggleMenuShortcut(toggleMenuShortcut) {
        this._setShortcut(this._keyToggleMenuShortcut, toggleMenuShortcut);
    }

    get togglePrivateModeShortcut() {
        return this._getShortcut(this._keyTogglePrivateModeShortcut);
    }

    set togglePrivateModeShortcut(togglePrivateModeShortcut) {
        this._setShortcut(this._keyTogglePrivateModeShortcut, togglePrivateModeShortcut);
    }

    get clearHistoryShortcut() {
        return this._getShortcut(this._keyClearHistoryShortcut);
    }

    set clearHistoryShortcut(clearHistoryShortcut) {
        this._setShortcut(this._keyClearHistoryShortcut, clearHistoryShortcut);
    }

    _getShortcut(key) {
        return this._settings.get_strv(key)[0] ?? ``;
    }

    _setShortcut(key, shortcut) {
        this._settings.set_strv(key, [shortcut]);
    }
});
