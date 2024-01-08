'use strict';

import GLib from 'gi://GLib';

const uuid = `clipman-lite@popov895.ukr.net`;

export const _ = (text, context) => {
    return context ? GLib.dpgettext2(uuid, context, text) : GLib.dgettext(uuid, text);
};

export const logError = (error) => {
    console.error(`${uuid}:`, error);
};
