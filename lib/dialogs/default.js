// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const adt = require('adt');

const ruleDialog = require('./rule');
const discoveryDialog = require('./discovery');
const configDialog = require('./config');
const helpDialog = require('./help');
const setupDialog = require('./setup');
const initDialog = require('./init');
const makeDialog = require('./make');
const fallback = require('./fallback');
const askAnything = require('./ask_anything');
const permissionGrant = require('./permission_grant');
const permissionRuleDialog = require('./permission_rule');
const { showNotification, showError } = require('./notifications');

const Intent = require('../semantic').Intent;

function* handleUserInput(dlg, intent) {
    if (intent.isFailed || intent.isFallback || intent.isTrain) {
        yield* fallback(dlg, intent);
    } else if (intent.isYes) {
        dlg.manager.stats.hit('sabrina-command-egg');
        dlg.reply(dlg._("I agree, but to what?"));
    } else if (intent.isNo) {
        dlg.manager.stats.hit('sabrina-command-egg');
        dlg.reply(dlg._("No way!"));
    } else if (intent.isProgram || intent.isPrimitive) {
        dlg.manager.stats.hit('sabrina-command-rule');
        yield* ruleDialog(dlg, intent, false);
    } else if (intent.isHelp) {
        dlg.manager.stats.hit('sabrina-command-help');
        yield* helpDialog(dlg, intent);
    } else if (intent.isMake) {
        dlg.manager.stats.hit('sabrina-command-make');
        yield* makeDialog(dlg, intent);
    } else if (intent.isSetup) {
        dlg.manager.stats.hit('sabrina-command-setup');
        yield* setupDialog(dlg, intent);
    } else if (intent.isPermissionRule) {
        dlg.manager.stats.hit('sabrina-command-permissionrule');
        yield* permissionRuleDialog(dlg, intent);
    } else {
        dlg.fail();
    }
}

function formatError(e) {
    if (e.name === 'SyntaxError') {
        return "Syntax error at line " + e.lineNumber + ": " + e.message;
    } else if (typeof e === 'string') {
        return e;
    } else if (e.message) {
        return e.message;
    } else {
        return e;
    }
}

function* loop(dlg, showWelcome) {
    yield* initDialog(dlg, showWelcome);

    let lastApp = undefined;
    while (true) {
        dlg.icon = null;
        let { item: next, resolve, reject } = yield dlg.nextQueueItem();

        try {
            let value;
            if (next.isUserInput) {
                lastApp = undefined;
                try {
                    value = yield* handleUserInput(dlg, next.intent);
                } catch(e) {
                    if (e.code !== 'ECANCELLED')
                        dlg.reply(dlg._("Sorry, I had an error processing your command: %s").format(formatError(e)));
                    throw e;
                }
            } else if (next.isNotification) {
                value = yield* showNotification(dlg, next.appId, next.icon, next.outputType, next.outputValue, next.currentChannel, lastApp);
                lastApp = next.appId;
            } else if (next.isError) {
                value = yield* showError(dlg, next.appId, next.icon, next.error, lastApp);
                lastApp = next.appId;
            } else if (next.isQuestion) {
                lastApp = undefined;
                value = yield* askAnything(dlg, next.appId, next.icon, next.type, next.question);
            } else if (next.isPermissionRequest) {
                lastApp = undefined;
                value = yield* permissionGrant(dlg, next.program, next.principal, next.identity);
            } else if (next.isInteractiveConfigure) {
                lastApp = undefined;
                if (next.kind !== null)
                    value = yield* configDialog(dlg, next.kind);
                else
                    value = yield* discoveryDialog(dlg);
            } else if (next.isRunProgram) {
                lastApp = undefined;
                value = yield* ruleDialog(dlg, Intent.Program(null, next.program), true, next.uniqueId);
            }

            resolve(value);
        } catch(e) {
            reject(e);
            if (e.code === 'ECANCELLED')
                continue;

            console.error('Failed to process Almond queue item: ' + e.message);
            console.error(e);
        }
    }
}

module.exports = loop;
