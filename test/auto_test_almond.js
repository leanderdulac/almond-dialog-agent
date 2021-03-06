// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

require('./polyfill');

const Q = require('q');
Q.longStackSupport = true;
const readline = require('readline');

const Almond = require('../lib/almond');
const ThingTalk = require('thingtalk');
const Type = ThingTalk.Type;

const Mock = require('./mock');

var buffer = '';
function writeLine(line) {
    //console.log(line);
    buffer += line + '\n';
}
function flushBuffer() {
    buffer = '';
}

var app = null;
function loadOneApp(code) {
    app = code;
}

class TestDelegate {
    constructor() {
    }

    send(what) {
        writeLine('>> ' + what);
        // die horribly if something does not work
        if (what.indexOf('that did not work') >= 0)
            setImmediate(() => process.exit(1));
    }

    sendPicture(url) {
        writeLine('>> picture: ' + url);
    }

    sendRDL(rdl) {
        writeLine('>> rdl: ' + rdl.displayTitle + ' ' + rdl.callback);
    }

    sendChoice(idx, what, title, text) {
        writeLine('>> choice ' + idx + ': ' + title);
    }

    sendLink(title, url) {
        writeLine('>> link: ' + title + ' ' + url);
    }

    sendButton(title, json) {
        writeLine('>> button: ' + title + ' ' + json);
    }

    sendAskSpecial(what) {
        writeLine('>> ask special ' + what);
    }
}

class MockUser {
    constructor() {
        this.id = 1;
        this.account = 'FOO';
        this.name = 'Alice Tester';
    }
}

// TEST_CASES is a list of scripts
// each script is a sequence of inputs and ouputs
// inputs are JSON objects in sempre syntax, outputs are buffered responses
// the last element of each script is the ThingTalk code that should be
// generated as a result of the script (or null if the script should not
// generate ThingTalk)

const TEST_CASES = [
    [{ special: "help" },
`>> Click on one of the following buttons to start adding command.
>> choice 0: When
>> choice 1: Get
>> choice 2: Do
>> ask special generic
`,
    null],

    [{"rule":{"query":{"args":[],"name":{"id":"tt:xkcd.get_comic"}},"action":{"args":[],"name":{"id":"tt:twitter.post_picture"}}}},
`>> You have multiple devices of type twitter. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> ask special generic
`,
    {"answer":{"type":"Choice","value":0}},
`>> What do you want to tweet?
>> choice 0: Use the title from xkcd
>> choice 1: Use the picture url from xkcd
>> choice 2: Use the link from xkcd
>> choice 3: Use the alt text from xkcd
>> choice 4: A description of the result
>> choice 5: None of above
>> ask special generic
`,
    {"answer":{"type":"Choice","value":2}},
`>> Upload the picture now.
>> choice 0: Use the picture url from xkcd
>> choice 1: None of above
>> ask special generic
`,
    {"answer":{"type":"Choice","value":0}},
`>> Ok, so you want me to get an Xkcd comic then tweet link with an attached picture with picture url equal to picture url. Is that right?
>> ask special yesno
`,
    { special: "yes" },
`>> Consider it done.
>> ask special null
`,
`AlmondGenerated() {
    now => @xkcd(id="xkcd-6").get_comic() , v_title := title, v_picture_url := picture_url, v_link := link, v_alt_text := alt_text => @twitter(id="twitter-foo").post_picture(caption=v_link, picture_url=v_picture_url) ;
}`],

    [{ action: { name: { id: 'tt:twitter.sink' }, args: [] } },
`>> You have multiple devices of type twitter. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> ask special generic
`,
     { answer: { type: 'Choice', value: 0 } },
`>> What do you want to tweet?
>> ask special generic
`,
     { answer: { type: 'String', value: { value: 'lol' } } },
`>> Ok, so you want me to tweet "lol". Is that right?
>> ask special yesno
`,
     { special: "yes" },
`>> Consider it done.
>> ask special null
`,
`AlmondGenerated() {
    now => @twitter(id="twitter-foo").sink(status="lol") ;
}`],

    [{ rule: {
        trigger: { name: { id: 'tt:twitter.source' }, args: [] },
        action: { name: { id: 'tt:facebook.post' }, args: [
            { name: { id: 'tt:param.status'}, operator: 'is',
              type: 'VarRef', value: { id: 'tt:param.text' } }
        ]}
    } },
`>> You have multiple devices of type twitter. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> ask special generic
`,
    { answer: { type: 'Choice', value: 0 } },
`>> Ok, so you want me to post text on Facebook when anyone you follow tweets. Is that right?
>> ask special yesno
`,
    { special: "yes" },
`>> Consider it done.
>> ask special null
`,
`AlmondGenerated() {
    @twitter(id="twitter-foo").source() , v_text := text, v_hashtags := hashtags, v_urls := urls, v_from := from, v_in_reply_to := in_reply_to => @facebook(id="facebook-7").post(status=v_text) ;
}`],

    [{ query: { name: { id: 'tt:xkcd.get_comic' }, args: [] } },
`>> ask special null
`,
`AlmondGenerated() {
    now => @xkcd(id="xkcd-8").get_comic() , v_title := title, v_picture_url := picture_url, v_link := link, v_alt_text := alt_text => notify;
}`],

    [{ query: { name: { id: 'tt:xkcd.get_comic' }, person: 'mom', args: [] } },
`>> Ok, so you want me to get an Xkcd comic using Almond of Mom Corp Inc.. Is that right?
>> ask special yesno
`,
    { special: "yes" },
`>> Sending rule to Mom Corp Inc.: get an Xkcd comic then send it to me
>> Consider it done.
>> ask special null
`,
`AlmondGenerated() {
    class @__dyn_0 extends @remote {
        trigger receive (in req __principal : Entity(tt:contact), in req __token : Entity(tt:flow_token), in req __kindChannel : Entity(tt:function), out number : Number, out title : String, out picture_url : Entity(tt:picture), out link : Entity(tt:url), out alt_text : String);
    }
    @__dyn_0.receive(__principal="mock-account:MOCK1234-phone:+1800666"^^tt:contact("Mom Corp Inc."), __token="XXX"^^tt:flow_token, __kindChannel="query:xkcd:get_comic"^^tt:function) , v_title := title, v_picture_url := picture_url, v_link := link, v_alt_text := alt_text => notify;
}`],

    [{"rule":{"trigger":{"args":[],"name":{"id":"tt:security-camera.new_event"}},"action":{"args":[],"name":{"id":"tt:twitter.post_picture"}}}},
`>> You have multiple devices of type security-camera. Which one do you want to use?
>> choice 0: Some Device 1
>> choice 1: Some Device 2
>> ask special generic
`,
    { answer: { type: 'Choice', value: 0 } },
`>> You have multiple devices of type twitter. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> ask special generic
`,
    { answer: { type: 'Choice', value: 0 } },
`>> What do you want to tweet?
>> choice 0: Use the picture url from security-camera
>> choice 1: A description of the result
>> choice 2: None of above
>> ask special generic
`,
    { answer: { type: 'Choice', value: 2 } },
`>> What do you want to tweet?
>> ask special generic
`,
    { answer: { type: 'String', value: { value: 'lol' } } },
`>> Upload the picture now.
>> choice 0: Use the picture url from security-camera
>> choice 1: None of above
>> ask special generic
`,
    { answer: { type: 'Choice', value: 0 } },
`>> Ok, so you want me to tweet "lol" with an attached picture with picture url equal to picture url when any event is detected on your security camera. Is that right?
>> ask special yesno
`,
    { special: "yes" },
`>> Consider it done.
>> ask special null
`,
`AlmondGenerated() {
    @security-camera(id="security-camera-1").new_event() , v_start_time := start_time, v_has_sound := has_sound, v_has_motion := has_motion, v_has_person := has_person, v_picture_url := picture_url => @twitter(id="twitter-foo").post_picture(caption="lol", picture_url=v_picture_url) ;
}`],

    [{"special":{"id":"tt:root.special.makerule"}},
`>> Click on one of the following buttons to start adding command.
>> choice 0: When
>> choice 1: Get
>> choice 2: Do
>> ask special generic
`,
    { answer: { type: 'Choice', value: 0 } },
`>> Pick one from the following categories or simply type in.
>> button: Do it now {"special":"tt:root.special.empty"}
>> button: Media {"command":{"type":"help","value":{"id":"tt:type.media"}}}
>> button: Social Networks {"command":{"type":"help","value":{"id":"tt:type.social-network"}}}
>> button: Home {"command":{"type":"help","value":{"id":"tt:type.home"}}}
>> button: Communication {"command":{"type":"help","value":{"id":"tt:type.communication"}}}
>> button: Health and Fitness {"command":{"type":"help","value":{"id":"tt:type.health"}}}
>> button: Services {"command":{"type":"help","value":{"id":"tt:type.service"}}}
>> button: Data Management {"command":{"type":"help","value":{"id":"tt:type.data-management"}}}
>> button: Back {"special":"tt:root.special.back"}
>> ask special command
`,
    {"trigger":{"args":[],"name":{"id":"tt:security-camera.new_event"}}},
`>> Add more commands and filters or run your command if you are ready.
>> choice 0: When: any event is detected on your security camera
>> choice 1: Get
>> choice 2: Do: notify me
>> choice 3: Add a filter
>> choice 4: Run it
>> ask special generic
`,
    { answer: { type: 'Choice', value: 1 } },
`>> Pick one from the following categories or simply type in.
>> button: Media {"command":{"type":"help","value":{"id":"tt:type.media"}}}
>> button: Social Networks {"command":{"type":"help","value":{"id":"tt:type.social-network"}}}
>> button: Home {"command":{"type":"help","value":{"id":"tt:type.home"}}}
>> button: Communication {"command":{"type":"help","value":{"id":"tt:type.communication"}}}
>> button: Health and Fitness {"command":{"type":"help","value":{"id":"tt:type.health"}}}
>> button: Services {"command":{"type":"help","value":{"id":"tt:type.service"}}}
>> button: Data Management {"command":{"type":"help","value":{"id":"tt:type.data-management"}}}
>> button: Back {"special":"tt:root.special.back"}
>> ask special command
`,
    {"query":{"args":[],"name":{"id":"tt:xkcd.get_comic"}}},
`>> Add more commands and filters or run your command if you are ready.
>> choice 0: When: any event is detected on your security camera
>> choice 1: Get: get an Xkcd comic
>> choice 2: Do: notify me
>> choice 3: Add a filter
>> choice 4: Run it
>> ask special generic
`,
    { answer: { type: 'Choice', value: 3 } },
`>> Pick the command you want to add filters to:
>> choice 0: When: any event is detected on your security camera
>> choice 1: Get: get an Xkcd comic
>> choice 2: Back
>> ask special generic
`,
    { answer: { type: 'Choice', value: 1 } },
`>> Pick the filter you want to add:
>> button: title is equal to ____ {"filter":{"name":"title","operator":"is","value":null,"type":"String"}}
>> button: title is not equal to ____ {"filter":{"name":"title","operator":"!=","value":null,"type":"String"}}
>> button: title contains ____ {"filter":{"name":"title","operator":"contains","value":null,"type":"String"}}
>> button: picture url is equal to ____ {"filter":{"name":"picture_url","operator":"is","value":null,"type":"Entity(tt:picture)"}}
>> button: picture url is not equal to ____ {"filter":{"name":"picture_url","operator":"!=","value":null,"type":"Entity(tt:picture)"}}
>> button: link is equal to ____ {"filter":{"name":"link","operator":"is","value":null,"type":"Entity(tt:url)"}}
>> button: link is not equal to ____ {"filter":{"name":"link","operator":"!=","value":null,"type":"Entity(tt:url)"}}
>> button: alt text is equal to ____ {"filter":{"name":"alt_text","operator":"is","value":null,"type":"String"}}
>> button: alt text is not equal to ____ {"filter":{"name":"alt_text","operator":"!=","value":null,"type":"String"}}
>> button: alt text contains ____ {"filter":{"name":"alt_text","operator":"contains","value":null,"type":"String"}}
>> button: Back {"special":"tt:root.special.back"}
>> ask special generic
`,
    {"filter":{"type":"String","operator":"contains","name":"title","value":null}},
`>> What's the value of this filter?
>> ask special generic
`,
    "lol",
`>> Add more commands and filters or run your command if you are ready.
>> choice 0: When: any event is detected on your security camera
>> choice 1: Get: get an Xkcd comic, title contains "lol"
>> choice 2: Do: notify me
>> choice 3: Add a filter
>> choice 4: Run it
>> ask special generic
`,
    { answer: { type: 'Choice', value: 4 } },
`>> You have multiple devices of type security-camera. Which one do you want to use?
>> choice 0: Some Device 1
>> choice 1: Some Device 2
>> ask special generic
`,
    { answer: { type: 'Choice', value: 0 } },
`>> Ok, I'm going to get an Xkcd comic if title contains "lol" when any event is detected on your security camera
>> ask special null
`,
    `AlmondGenerated() {
    @security-camera(id="security-camera-1").new_event() , v_start_time := start_time, v_has_sound := has_sound, v_has_motion := has_motion, v_has_person := has_person, v_picture_url := picture_url => @xkcd(id="xkcd-9").get_comic(), title =~ "lol" , v_title := title, v_picture_url := picture_url, v_link := link, v_alt_text := alt_text => notify;
}`]
];

function roundtrip(input, output) {
    flushBuffer();
    if (typeof input === 'string') {
        //console.log('$ ' + input);
        return almond.handleCommand(input).then(() => {
            if (output !== null && buffer !== output)
                throw new Error('Invalid reply from Almond: ' + buffer);
        });
    } else {
        var json = JSON.stringify(input);
        //console.log('$ \\r ' + json);
        return almond.handleParsedCommand(json).then(() => {
            if (output !== null && buffer !== output)
                throw new Error('Invalid reply from Almond: ' + buffer);
        });
    }
}

function cleanToken(code) {
    if (code === null)
        return null;
    return code.replace(/__token="[a-f0-9]+"/g, '__token="XXX"');
}

function test(script, i) {
    console.error('Test Case #' + (i+1));

    flushBuffer();
    app = null;

    function step(j) {
        if (j === script.length-1)
            return Q();

        return roundtrip(script[j], script[j+1]).then(() => step(j+2));
    }
    return roundtrip({"special":"nevermind"}, null).then(() => step(0)).then(() => {
        var expected = script[script.length-1];
        app = cleanToken(app);
        expected = cleanToken(expected);
        if (app !== expected) {
            console.error('Test Case #' + (i+1) + ': does not match what expected');
            console.error('Expected: ' + expected);
            console.error('Generated: ' + app);
        } else {
            console.error('Test Case #' + (i+1) + ' passed');
        }
    }).catch((e) => {
        console.error('Test Case #' + (i+1) + ': failed with exception');
        console.error('Error: ' + e.message);
        console.error(e.stack);
    });
}

function promiseDoAll(array, fn) {
    function loop(i) {
        if (i === array.length)
            return Q();

        return Q(fn(array[i], i)).then(() => loop(i+1));
    }
    return loop(0);
}

var almond;

function main() {
    var engine = Mock.createMockEngine();
    // mock out getDeviceSetup
    engine.thingpedia.getDeviceSetup = (kinds) => {
        var ret = {};
        for (var k of kinds) {
            ret[k] = {type:'none',kind:k};
        }
        return Q(ret);
    }
    // intercept loadOneApp
    engine.apps.loadOneApp = loadOneApp;

    var delegate = new TestDelegate();

    var sempreUrl;
    if (process.argv[2] !== undefined && process.argv[2].startsWith('--with-sempre='))
        sempreUrl = process.argv[2].substr('--with-sempre='.length);
    almond = new Almond(engine, 'test', new MockUser(), delegate,
        { debug: false, sempreUrl: sempreUrl, showWelcome: true });

    almond.start();
    flushBuffer();

    promiseDoAll(TEST_CASES, test).done();
}
main();
