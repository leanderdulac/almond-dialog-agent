// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016-2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;
const Generate = ThingTalk.Generate;
const Describe = ThingTalk.Describe;
const SEMPRESyntax = ThingTalk.SEMPRESyntax;

const ValueCategory = require('../semantic').ValueCategory;
const Helpers = require('../helpers');

const { slotFillSingle } = require('./slot_filling');

function getIdentityName(dlg, identity) {
    var split = identity.split(':');

    if (split[0] === 'omlet')
        return dlg._("Omlet User @%s").format(split[1]);

    let contactApi = dlg.manager.platform.getCapability('contacts');
    if (contactApi !== null) {
        return contactApi.lookupPrincipal(identity).then((contact) => {
            if (contact)
                return contact.displayName;
            else
                return split[1];
        });
    } else {
        return split[1];
    }
}

function convertPrimitiveToPermission(prim, scope) {
    if (prim === null)
        return Ast.PermissionFunction.Builtin;

    let filter = [];
    for (let inParam of prim.in_params) {
        // unbound variable (coming from @remote.receive)
        if (inParam.value.isVarRef && !scope[inParam.value.name])
            continue;
        filter.push(Ast.Filter(inParam.name, '=', inParam.value));
    }
    filter = Ast.BooleanExpression.And([prim.filter,
        Ast.BooleanExpression.And(filter.map((f) => Ast.BooleanExpression.Atom(f)))]);
    filter = Generate.optimizeFilter(filter);

    for (let outParam of prim.out_params)
        scope[outParam.name] = outParam.value;
    return new Ast.PermissionFunction.Specified(prim.selector.kind, prim.channel, filter, prim.out_params, prim.schema);
}

function convertToPermissionRule(principal, contactName, program) {
    let rule;
    if (program.rules.length > 1) {
        console.log('NOT IMPLEMENTED: cannot support more than one rule');
        return null;
    }
    rule = program.rules[0];

    let trigger = null, query = null, action = null;
    if (rule.trigger && !isRemoteReceive(rule.trigger))
        trigger = rule.trigger;
    if (rule.queries.length > 1) {
        console.log('NOT IMPLEMENTED: cannot support more than one query');
        return null;
    }
    if (rule.queries.length === 1)
        query = rule.queries[0];
    if (rule.actions.length > 1) {
        console.log('NOT IMPLEMENTED: cannot support more than one action');
        return null;
    }
    if (!rule.actions[0].selector.isBuiltin && !isRemoteSend(rule.actions[0]))
        action = rule.actions[0];

    let scope = {}
    return new Ast.PermissionRule(Ast.Value.Entity(principal, 'tt:contact', contactName), convertPrimitiveToPermission(trigger, scope),
        convertPrimitiveToPermission(query, scope), convertPrimitiveToPermission(action, scope));
}

function isRemoteReceive(fn) {
    return (fn.selector.kind === 'org.thingpedia.builtin.thingengine.remote' || fn.selector.kind.startsWith('__dyn_')) &&
        fn.channel === 'receive';
}
function isRemoteSend(fn) {
    return (fn.selector.kind === 'org.thingpedia.builtin.thingengine.remote' || fn.selector.kind.startsWith('__dyn_')) &&
        fn.channel === 'send';
}

function* checkPermissionRule(dlg, principal, program, permissionRule) {
    let description = Describe.describePermissionRule(dlg.manager.gettext, permissionRule);
    dlg.reply(dlg._("Ok, I'll remember that %s").format(description));

    yield dlg.manager.permissions.addPermission(permissionRule, description);
    return yield dlg.manager.permissions.checkIsAllowed(principal, program);
}

function describeFilter(dlg, _T, schema, filter) {
    let value = ThingTalk.Describe.describeArg(dlg.manager.gettext, filter.value);
    let argname = filter.name;
    let index = schema.index[argname];
    let argcanonical = schema.argcanonicals[index] || argname;

    // translations come from ThingTalk, hence the _T
    // otherwise they will be picked up by xgettext for Almond
    switch (filter.operator) {
    case 'contains':
    case 'substr':
    case '=~':
        return _T("%s contains %s").format(argcanonical, value);
    case 'in_array':
    case '~=':
        return _T("%s contains %s").format(value, argcanonical);
    case '=':
        return _T("%s is equal to %s").format(argcanonical, value);
    case '!=':
        return _T("%s is not equal to %s").format(argcanonical, value);
    case '<':
        return _T("%s is less than %s").format(argcanonical, value);
    case '>':
        return _T("%s is greater than %s").format(argcanonical, value);
    case '<=':
        return _T("%s is less than or equal to %s").format(argcanonical, value);
    case '>=':
        return _T("%s is greater than or equal to %s").format(argcanonical, value);
    default:
        throw new TypeError('Invalid operator ' + filter.operator);
    }
}

function makeFilterCandidates(permissionFunction) {
    if (!permissionFunction.isSpecified)
        return [];

    let schema = permissionFunction.schema;
    let filterCandidates = [];

    function doMake(from) {
        for (let argname in from) {
            let type = from[argname];
            let ops;
            if (type.isString) {
                ops = ['=', '!=', '=~'];
            } else if (type.isNumber || type.isMeasure) {
                ops = ['=', '<', '>', '>=', '<='];
            } else if (type.isArray) {
                ops = ['contains'];
            } else {
                ops = ['=', '!='];
            }
            for (let op of ops)
                filterCandidates.push(new Ast.Filter(argname, op, Ast.Value.Undefined(true)));
        }
    }
    doMake(schema.inReq);
    doMake(schema.out);
    return filterCandidates;
}

function* addFilter(dlg, rule) {
    // reuse thingtalk's translations here
    const _T = dlg.manager.gettext.dgettext.bind(dlg.manager.gettext, 'thingtalk');

    while (true) {
        let filterCandidates = {
            trigger: makeFilterCandidates(rule.trigger),
            query: makeFilterCandidates(rule.query),
            action: makeFilterCandidates(rule.action)
        };
        let scope = {};
        let filterDescription = [
            rule.trigger.isSpecified ? Describe.describePermissionFunction(dlg.manager.gettext, rule.trigger, 'trigger', scope) : '',
            rule.query.isSpecified ? Describe.describePermissionFunction(dlg.manager.gettext, rule.query, 'query', scope) : '',
            rule.action.isSpecified ? Describe.describePermissionFunction(dlg.manager.gettext, rule.action, 'action', scope) : ''
        ]

        let primTypes = [];
        let filterCommandChoices = [];
        if (filterCandidates.trigger.length > 0) {
            primTypes.push('trigger');
            filterCommandChoices.push(dlg._("When: %s").format(filterDescription[0]));
        }
        if (filterCandidates.query.length > 0) {
            primTypes.push('query');
            filterCommandChoices.push(dlg._("Get: %s").format(filterDescription[1]));
        }
        if (filterCandidates.action.length > 0) {
            primTypes.push('action');
            filterCommandChoices.push(dlg._("Do: %s").format(filterDescription[2]));
        }
        filterCommandChoices.push(dlg._("Done"));
        filterCommandChoices.push(dlg._("Back"));

        let choice = yield dlg.askChoices(dlg._("Pick the part you want to add restrictions to:"), filterCommandChoices);
        if (choice === filterCommandChoices.length - 2) {
            // done!
            return rule;
        }
        if (choice === filterCommandChoices.length - 1) {
            // go back to the top
            return null;
        }
        let prim = rule[primTypes[choice]];

        dlg.reply(dlg._("Pick the filter you want to add:"));

        const schema = prim.schema;
        filterCandidates[primTypes[choice]].forEach((filter) => {
            let argname = filter.name;
            let ptype = schema.inReq[argname] || schema.out[argname];
            let vtype = ptype;
            if (filter.operator === 'contains')
                vtype = ptype.elem;

            let op;
            if (filter.operator === '=')
                op = 'is';
            else if (filter.operator === '=~')
                op = 'contains';
            else if (filter.operator === 'contains')
                op = 'has';
            else
                op = filter.operator;

            let obj = {
                filter: {
                    name: argname,
                    operator: op,
                    value: null,
                    type: vtype.isMeasure ? 'Measure' : String(vtype)
                }
            };
            if (vtype.isMeasure)
                obj.filter.unit = vtype.unit;
            dlg.replyButton(describeFilter(dlg, _T, schema, filter), JSON.stringify(obj));
        });
        dlg.replyButton(dlg._("Back"), JSON.stringify({ special: 'back' }));

        let filterIntent = yield dlg.expect(ValueCategory.PermissionResponse);
        if (filterIntent.isBack)
            return null;
        if (filterIntent.isPermissionRule)
            return filterIntent.rule;

        let predicate;
        if (filterIntent.isFilter) {
            let filter = filterIntent.filter;
            let argname = filter.name;
            let ptype = schema.inReq[argname] || schema.inOpt[argname] || schema.out[argname];

            if (filter.value.isUndefined) {
                let question = dlg._("What's the value of this filter?");
                let vtype = ptype;
                if (filter.operator === 'contains')
                    vtype = ptype.elem;
                filter.value = yield* slotFillSingle(dlg, vtype, question);
            }
            predicate = Ast.BooleanExpression.Atom(filter);
        } else {
            predicate = filterIntent.predicate;
        }

        prim.filter = Generate.optimizeFilter(Ast.BooleanExpression.And([prim.filter, predicate]));
    }
}

module.exports = function* permissionGrant(dlg, program, principal, identity) {
    let contactName = yield getIdentityName(dlg, identity);
    let description = Describe.describeProgram(dlg.manager.gettext, program);

    let primitiveList = [];
    let hasTrigger = false;
    program.rules.forEach((r) => {
        if (r.trigger) {
            hasTrigger = true;
            primitiveList.push(r.trigger);
        }
        primitiveList = primitiveList.concat(r.queries);
        primitiveList = primitiveList.concat(r.actions.filter((a) => !a.selector.isBuiltin));
    });

    function computeIcon() {
        for (let i = primitiveList.length-1; i >= 0; i--) {
            let prim = primitiveList[i];
            if (prim.selector.kind !== 'remote' && !prim.selector.kind.startsWith('__dyn') &&
                prim.selector.kind.indexOf('.') >= 0)
                return prim.selector.kind;
        }
        return null;
    }
    dlg.icon = computeIcon();

    let permissionRule = convertToPermissionRule(principal, contactName, program);
    let anybodyPermissionRule = permissionRule.clone();
    anybodyPermissionRule.principal = null;
    let emptyPermissionRule = permissionRule.clone();
    if (emptyPermissionRule.trigger.isSpecified)
        emptyPermissionRule.trigger.filter = Ast.BooleanExpression.True;
    if (emptyPermissionRule.query.isSpecified)
        emptyPermissionRule.query.filter = Ast.BooleanExpression.True;
    if (emptyPermissionRule.action.isSpecified)
        emptyPermissionRule.action.filter = Ast.BooleanExpression.True;
    try {
        if (permissionRule) {
            console.log('Converted into permission rule: ' + Ast.prettyprintPermissionRule(permissionRule));

            dlg.reply(dlg._("%s wants to %s").format(contactName, description));

            while (true) {
                dlg.replyButton(dlg._("Yes this time"), JSON.stringify({ "special": "yes" }));
                dlg.replyButton(dlg._("Always from anybody"), JSON.stringify(SEMPRESyntax.toSEMPRE(anybodyPermissionRule)));
                dlg.replyButton(dlg._("Always from %s").format(contactName), JSON.stringify(SEMPRESyntax.toSEMPRE(permissionRule)));
                dlg.replyButton(dlg._("No"), JSON.stringify({ "special": "no" }));
                dlg.replyButton(dlg._("Maybe"), JSON.stringify({ "special": "maybe" }));

                let answer = yield dlg.expect(ValueCategory.PermissionResponse);
                if (answer.isYes)
                    return true;
                if (answer.isPermissionRule)
                    return yield* checkPermissionRule(dlg, principal, program, answer.rule);
                if (answer.isMaybe) {
                    let newRule = yield* addFilter(dlg, emptyPermissionRule);
                    if (!newRule)
                        continue;
                    return yield* checkPermissionRule(dlg, principal, program, newRule);
                }
                return false;
            }
        } else {
            // we can't make a permission rule out of this...

            return yield dlg.ask(ValueCategory.YesNo, dlg._("%s wants to %s").format(contactName, description));
        }
    } catch(e) {
        if (e.code === 'ECANCELLED')
            return false;
        throw e;
    }
}
