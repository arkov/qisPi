'use strict'

const SIGNED_UP = ['angemeldet']

const puppeteer = require('puppeteer');
const assert = require('assert').strict;
const { Telegraf, Markup, session  } = require('telegraf');

const db = require('better-sqlite3')('qispi.db', { verbose: (verbose) => {console.log('!SQL ', getLogTime(), verbose)} });
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
if (process.env['START_CLEAN']) {
    console.log(`!! ${getLogTime()} START_CLEAN: Dropping tables`)
    db.prepare('DROP TABLE IF EXISTS subjects').run();
    db.prepare('DROP TABLE IF EXISTS users').run();
}

const {readFileSync} = require('fs');
const { type } = require('os');

const OK = 'OK'; // todo
const DEBUG = process.env['DEBUG']
console.log('!! DEBUG: ', DEBUG)
const CHROMIUM_PATH = process.env['CHROMIUM_PATH']// ? process.env['CHROMIUM_PATH'] : '/usr/bin/chromium-browser'
console.log('!! Using CHROMIUM_PATH: ', CHROMIUM_PATH ? CHROMIUM_PATH : 'default')

const {
    QIS_PASSWORD, QIS_USER, CHAT_ID, BOT_TOKEN, DEGREE, INTERVAL_SECONDS, STUDY_PROGRAM
} = initializeGlobal();

let lastheartbeat = -1; // todo either remove or utilize sqlite

db.prepare('CREATE TABLE IF NOT EXISTS users (chatid INTEGER PRIMARY KEY, pinned INTEGER, name TEXT)').run();
db.prepare('CREATE TABLE IF NOT EXISTS subjects (chatid INTEGER KEY, prfnr TEXT KEY, FOREIGN KEY (chatid) references users (chatid), UNIQUE(chatid, prfnr))').run(); // integer might not be enough, but also a mess to handle. not worth it to me
db.prepare('CREATE INDEX IF NOT EXISTS chatid_index ON subjects (chatid)').run();
db.prepare('CREATE TABLE IF NOT EXISTS reportcard (chatid INTEGER PRIMARY KEY, prfnr TEXT, grade TEXT, state TEXT, FOREIGN KEY (chatid))').run(); // here we save all exam states. as soon as there exists a delta, we send a message to the user.
const bot = initializeBot(BOT_TOKEN);
setTimeout( () => { // ugly but whatever. bot might not be ready yet. and wanted to keep bot const for fun, otherweise initBot().then...
    checkQIS(CHAT_ID, false)
    start(INTERVAL_SECONDS)
}, 5 * 1000)

async function checkQIS(CHAT_ID, upd = false) {
    let browser, page // keep it in scope so catch can close.
    try {
        ({browser, page} = await getBrowser(CHROMIUM_PATH));

        await getToTable(page);
        const {subjects, update} = await getSubjectsFromTable(page);
        
        browser = await closeBrowser(browser).then( success => {
            if (success) {
                console.log(`!! Browser closed succesfully in checkQIS()`)
                browser = null;
            } else {
                console.log(`!!! ${getLogTime()} Browser could not be closed in checkQIS()`)
            }
            return null;
        }).then( () => page = null) // sanity check, todo
        .catch( err => {
            console.log(`!!! ${getLogTime()} Browser could not be closed in checkQIS() due to error: ${err.stack}`)
            return null;  
        });
        
        if (update !== OK) console.log(`!!! ${getLogTime()} Update not OK: ${update}`);
        let { message, miscexams } = processSubjects(subjects);
            
        let lookingformsg = "Looking for:\n" 
            + getSubjects(CHAT_ID)
                .map(prf => {
                    return subjects[prf] ? `${prf}: ${subjects[prf].title}` : `${prf}: not found.`;
                }).join("\n");
        
        
        
        // upd = true if update was requested by user, thus send verbose message
        if (upd) {
            let verboseupdate = message + miscexams.trim() + "\n\n" + lookingformsg.trim() // Concrete update (bestanden, etc) + miscexams (angemeldet) +  Looking for: (PrfNr: Title) 
            await sendMessage(CHAT_ID, verboseupdate)
        }
        else if (message.length > 0) await sendMessage(CHAT_ID, message)
                
        heartbeat(CHAT_ID).catch(e => console.log('!!! ', getLogTime(), e.stack, "Issue with heartbeat"))

        if (getSubjects(CHAT_ID).length === 0) { // todo check whether rest of exams are all junk
            console.log(`!! ${getLogTime()} Alle Klausuren wurden eingetragen.`)
            sendMessage(CHAT_ID, "Alle Klausuren wurden eingetragen!")
            process.exit(0)
        }

    } catch(e) {
        console.log(`!!! ${getLogTime()} Issue with checkQIS() `, e.stack)
        closeBrowser(browser);
    }
    
}

/**
 * Sends a heartbeat after each QIS scrape that the bot is still alive, by editing the pinned message and updating the time.
 * @param {String, int} chatid 
 */
async function heartbeat(chatid) {
    if (DEBUG) return;
    if (!bot) console.log(`!!! ${getLogTime()} Bot is undefined in heartbeat`)

    let pinned = getPinnedMessage(chatid)
    if (!pinned) {
        console.error(`!!! ${getLogTime()} No pinned message found`)
        sendMessage(chatid, 'No pinned message found, please hit /start')
        return;
    }
    if (lastheartbeat != getTime()) {
        lastheartbeat = getTime()
        bot.telegram.editMessageText(
            chatid,
            pinned,
            undefined,
            "Last updated: " + getTime()
        );
        
        console.log(`!! ${getLogTime()} Heartbeat sent to ${chatid} via ${pinned}`);
    }
}

/** 
 * Returns the current time as a formatted string, used mostly for heartbeat to edit pinned message
 * @returns {string} formatted time as HH:MM:SS, DD.MM in 16:20.01, 24.12.
*/
function getTime() {
    const date = new Date();

    const hour = date.getHours().toString().padStart(2, '0');
    const minute = date.getMinutes().toString().padStart(2, '0');
    const second = date.getSeconds().toString().padStart(2, '0');
    
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0'); // Months are zero-based
    
    const timeFormat = `${hour}:${minute}.${second}`;
    const dateFormat = `${day}.${month}.`;
    
    return `${timeFormat}, ${dateFormat}`;
}

/**
 * 
 * @param {puppeteer.Browser} browserInstance 
 * @returns {boolean} true if browser was closed successfully or was already closed, false if timeout was reached
 */
async function closeBrowser(browserInstance) {
    if (browserInstance) {
        console.log(`!! ${getLogTime()} Attempting browser.close()`);
        
        let result = await Promise.race([
            browserInstance.close().then(() => 'closed'),
            new Promise(resolve => setTimeout(() => resolve('timeout'), 5 * 60 * 1000))
        ]);

        if (result === 'closed') {
            console.log(`!! ${getLogTime()} Browser closed successfully`);
            return true;  // Indicate successful closure
        } else {
            console.log(`!!! ${getLogTime()} Timeout reached while trying to close browser`);
            return false; // Indicate unsuccessful closure
        }
    }
    return true;  // Indicate no browser instance to close
}

/**
 * Will soon rely less or not at all on global variables and thus config.json
 * @returns {Object} Config object used for global variables. 
 */
function initializeGlobal() {
    const config = JSON.parse(readFileSync('./config.json', 'utf-8'));
    ['QIS_PASSWORD', 'QIS_USER', 'BOT_TOKEN', 'DEGREE', 'INTERVAL_MINUTES', 'STUDY_PROGRAM', 'CHAT_ID']
        .forEach(key => assert(config[key] !== undefined, `Missing key ${key}`))

    config['INTERVAL_SECONDS'] = config['INTERVAL_MINUTES'] * 60;
    config['CHAT_ID'] = Number(config['CHAT_ID'])
    return config;
}

/**
 * Initializes the bot with all the required middleware
 * @param {String} BOT_TOKEN 
 * @returns {Telegraf} bot instance
 */
function initializeBot(BOT_TOKEN) {
    const bot = new Telegraf(BOT_TOKEN)
    console.log(`!! ${getLogTime()} Bot created`)
    bot.start((ctx) => {
        (async () => {
            console.log(`!! ${getLogTime()} ${ctx.message.from.username} started the bot`)
            // it seems to be quite a brute-force approach that fails if there are no pinned messages. try-catch is the only way to go
            if (ctx.message.chat.id !== CHAT_ID) {
                return ctx.reply('You are not authorized to use this bot.')
            }

            await bot.telegram.unpinAllChatMessages(CHAT_ID)
            .then(() => console.log(`!! ${getLogTime()} Unpinned all messages`))
            .catch((e) => console.log(`!!! ${getLogTime()} `, e.stack, "Unpinning failed"))
            await ctx.reply('Welcome! Write \'update\' to get started or press the big button below! Otherwise, write \'add\' or \'del\' followed by the Number of the exam to add or delete exams to track. \n\n',
                Markup.keyboard([['🔍 Update']]).resize()
            )
            let message = await ctx.reply('Last updated: not yet 😶')
            
            bot.telegram.pinChatMessage(ctx.message.chat.id, message.message_id)
            
            let out = db.prepare('INSERT OR REPLACE INTO users (chatid, pinned, name) VALUES (@chatid, @pinned, @name)').run({chatid: ctx.message.chat.id, pinned: message.message_id, name: ctx.message.from.username}); // todo
            console.log(`!! ${getLogTime()} Trying to insert user -- again? `, out.changes > 0)
            await checkQIS(CHAT_ID, false)    
        })();
    
    })

    bot.on('message', (ctx, next) => {
        console.log(`!! ${getLogTime()} ${ctx.message.from.username} sent a message`);
        if (db.prepare('SELECT * FROM users WHERE chatid = @chatid').get({chatid: ctx.message.chat.id}) === undefined) ctx.reply('boohoo i dont know you')
        else next();
    })

    bot.hears('hi', (ctx) => ctx.reply('Hey there 👋'))
    
    bot.hears(/^del/, (ctx, next) => {
        let splits = ctx.message.text.split(/del\w*\s*/)
        if (splits.length < 2 || !splits[1]) return ctx.reply('Malformatted request. Please write \'del\' followed by the PrfNr of the exam you want to remove, i.e. \'del 123\', seperated by a space and without the quotes.')
        ctx.reply(removeSubjects(ctx.message.chat.id, splits[1].trim()))
        // next();
    })
    
    bot.hears(/^add/, (ctx, next) => {
        let splits = ctx.message.text.split(/add\w*\s*/)
        if (splits.length < 2 || !splits[1]) return ctx.reply('Malformatted request. Please write \'add\' followed by the PrfNr of the exam you want to add, i.e. \'add 123\', without the quotes.')
        ctx.reply(addSubjects(ctx.message.chat.id, splits[1].trim()))
        // next();
    })
    
    bot.on('message', (ctx, next) => {
        if (ctx.message.sticker) {
            ctx.replyWithSticker('CAACAgUAAxkBAAOxZPofDwT13OHHzqgEyeWuRvOyNjMAAq0AA3F9_BSt-1jh-tOaOTAE')
        }
        next();
    });
    
    bot.hears(
        new RegExp('(?:🔍)?\\s*[Uu]pdate'), 
        ctx => {
            ctx.reply('Coming right up')
            console.log(`!! Update requested at ${getTime()}`)
            checkQIS(CHAT_ID, true)
        }    
    )

    if (!DEBUG) {
        console.log(`!! ${getLogTime()} Launching bot`)
        bot.launch() // even though async, it never resolves!
        
        
        process.once('SIGINT', () => bot.stop('SIGINT'))
        process.once('SIGTERM', () => bot.stop('SIGTERM'))
        
        bot.telegram.getMe().then((res) => {
            console.log(`!! ${getLogTime()} Bot started: ${res.username}`)
        })
        // setInterval(() => {
        //     bot.telegram.getMe()
        // }, 1000)
    }
    return bot;
} 

/**
 * 
 * @param {int} INTERVAL_SECONDS Set the interval in seconds to scrape QIS 
 */
async function start(INTERVAL_SECONDS) {
    assert (INTERVAL_SECONDS > 60, "Interval_SECONDS must be more than 60 seconds, otherwise you will not have a fun time.")
    console.log(`!! ${getLogTime()} Starting interval Interval: ${INTERVAL_SECONDS}`)

    setInterval(() => {
        let date = new Date();
        let hour = date.getHours();
        
        if (hour >= 6 && hour <= 22) {
            console.log(`!! running (${getLogTime()}) ...`);
            checkQIS(CHAT_ID, false);
        } else {
            console.log(`!! sleeping (${getLogTime()}) ...`);
        }
    }, INTERVAL_SECONDS * 1000)
}

/**
 * 
 * @returns {string} formatted date
 */
function getLogTime() {
    let date = new Date();
    let formattedDate = date.toLocaleString();
    return formattedDate;
}

/**
 * Outsources the page traversal to a separate function
 * @param {puppeteer.Page} page 
 */
async function getToTable(page) {
    try {
        await page.goto('https://qis.verwaltung.uni-hannover.de/', { waitUntil: 'networkidle0'}) // TODO
        //  Login
        await page.type('input#asdf.input_login', QIS_USER)
        await page.type('input#fdsa.input_login', QIS_PASSWORD)
        await page.click('input.submit')
        
        await page.waitForXPath('//a[text()="Mein Studium"]')
        await page.$x('//a[text()="Mein Studium"]')
        .then(res => res[0].click())
        
        await page.waitForXPath('//a[text()="Notenspiegel / Studienverlauf"]')
        await page.$x('//a[text()="Notenspiegel / Studienverlauf"]')
        .then(res => res[0].click())

        await page.waitForXPath(`//div[@class="content"]//a[text()="${DEGREE}"]`)
        await page.$x(`//div[@class="content"]//a[text()="${DEGREE}"]`)
            .then(res => res[0].click())

        await page.waitForXPath(`//div[@class="content"]//*[normalize-space(text())="${STUDY_PROGRAM}"]/following::a[1]`)
        await page.$x(`//div[@class="content"]//*[normalize-space(text())="${STUDY_PROGRAM}"]/following::a[1]`)
            .then(res=>res[0].click())

        await page.waitForXPath(`//table`)
    } catch(e) {
        console.log(`!!! Issue with page traversal ${getLogTime()} `, e.stack)
        closeBrowser(browser);
    }
}

/**
 * Processes the table and returns an object with all the subjects and their respective grades and states, with hopefully no dummy-entries
 * @param {puppeteer.Browser} page 
 * @returns {Object} {subjects: {key: {title, grade, state}}, update: "OK"} If all goes fine.
 */
async function getSubjectsFromTable(page) {
    assert(page, "Page is undefined")
    return await page.$$eval('tbody', (t) => {
        /**
         * @param key: Prfnr
         * @param value: {title, grade, state}
         */
        let subjects = {}
        let rows;
        if (t && t.length >= 2) {
            t = t[1]
            if (t) rows = t.rows // todo
            else return {subjects: subjects, update: "firsts"} // todo
        } else {
            return {subjects: subjects, update: "More tables than expected"}
        }

        for (let i = 1; i < rows.length; ++i) {
            if (!(rows[i] && rows[i].cells)) continue; // todo
            if (rows[i].cells.length < 11) continue;
            if (rows[i].cells[5].innerText.length < 1) continue; // todo
            /**
            * @param 0: PrfNr
            * @param 1: Title of exam
            * @param 4: Grade
            * @param 5: State [angemeldet, bestanden, nicht bestanden, nicht erschienen, verschoben]
            */
            let cells = rows[i].cells

            subjects[cells[0].innerText] = {
                title: cells[1].innerText,
                grade: cells[4].innerText,
                state: cells[5].innerText
            }
        }
        return {subjects: subjects, update: 'OK'}
    })
}

/**
 * 
 * @param {string} state The state of the exam taken from QIS. For example: angemeldet
 * @returns 
 */
function isSignedUp(state) {
    return SIGNED_UP.includes(state)
}


/**
 * 
 * @param {Object} subjects from the 'tbody' of QIS (getSubjectsFromTable()) 
 * @returns {Object} {message: string, miscexams: string} 
 * message is the noteworthy message with at least one explicit update to be sent to the user on our own.
 * miscexams is a sanity check to see whether the bot is working and spits out all exams (among them are angemeldet and so on). used when user requests an update themselves.
 */
function processSubjects(subjects) {
    let message = ""
    let miscexams = "" // sanity check to check whether bot is working, spits out all + angemeldet exams
    let currentsubjects = getSubjects(CHAT_ID);

    Object.keys(subjects).forEach( key => {
        /**
         * @param state: [angemeldet, bestanden, nicht bestanden, nicht erschienen, verschoben]
         * @param title
         * @param grade
         */
        let subject = subjects[key]
        // Exam not in list yet

        if (currentsubjects.indexOf(key) < 0) {
            if (isSignedUp(subject.state)) {
                addSubjects(CHAT_ID, key);
            }
            // else continue; // Only interested in 'unseen' exams that are angemeldet
        }
        // Exam in list
        else if (currentsubjects.indexOf(key) >= 0 || getSubjects(CHAT_ID).indexOf(key) >= 0) { // try not to look up table all the time
            switch(subject.state) { // So far, we only distinct between angemeldet (still need to track further) and everything else (can be deleted, no more tracking)
                case SIGNED_UP[0]: // todo wrt to SIGNED_UP variable above
                    miscexams += `${subject.title}:\n${subject.state}\n\n`;
                    break;

                default: {
                    message += `${subject.title}:\n` + ((subject.grade.length) > 0 ? `${subject.grade} ` : '') + `${subject.state}\n\n`
                    removeSubjects(CHAT_ID, key) // safe to delete now
                    break;
                }
            }
        }
        
        // We might have an exam grade posted, even though it never got formally signed-up on/announced.
        // In that case, we spurt out the grade if it never had been seen before and 
        // else if (subject.state !== 'angemeldet') {
        //     addSubjects(CHAT_ID, key);
        // }
        
        else console.log(`Something went severly wrong with ${key} and ${subject}`)
    })
    console.log(`!! Processed ${Object.keys(subjects).length} subjects`)
    return {message: message, miscexams: miscexams}
}

/**
 * Sends trimmed message to chatid
 * @param {number, string} chatid
 * @param {string} message 
 */
async function sendMessage(chatid, message) {
    if (DEBUG) return;
    bot.telegram.sendMessage(chatid, message.trim())
    .catch(e => console.log(`!!! ${getLogTime()} `, e.stack, "Issue with sending message"))
}

async function getBrowser(CHROMIUM_PATH) {
    try {
        const browser = await puppeteer.launch({ // todo whether the settings are needed
            args: [
                '--window-size=1024,768',
                '--lang=de-DE,de',
                '--disable-dev-shm-usage',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--no-zygote',
                '--single-process',
                '--disable-extensions',
            ],
            executablePath: CHROMIUM_PATH ? CHROMIUM_PATH : undefined,   
            headless: process.env['NO_HEADLESS'] ? false : 'new' // use false for debugging
        }).catch(e => console.log('!!! ', getLogTime(),  e.stack, "Issue with browser", closeBrowser(browser)))
        
        console.log(`!! ${getLogTime()} browser PID: ${browser.process().pid}`)

        const page = await browser.newPage()
        console.log(`!! ${getLogTime()} newPage`)

        await page.setViewport({
            width: 1024,
            height: 768
        });
        return {browser: browser, page: page}
    } catch(e){
        console.log(`!!! ${getLogTime()} Issue with browser`, e.stack)
    }
}

/**
 * could make async
 * @param {*} chatid 
 * @param {*} prfnr 
 * @returns 
 */
function addSubjects(chatid, prfnr) {
    if (prfnr === undefined || chatid  === undefined) return console.log(`!!! ${getLogTime()} prfnr is undefined in addSubjects()`) // todo returning consolelog looks stupid
    if (['number', 'string'].includes(typeof prfnr)) prfnr = [prfnr]
    
    return prfnr.map(
        prfnr => {
            let success = db.prepare('INSERT OR IGNORE INTO subjects (chatid, prfnr) VALUES (@chatid, @prfnr)').run({chatid, prfnr}).changes
            if (success > 0) return "Added " + prfnr
            else return "Already looking for " + prfnr
        }
    ).join("\n")
    // db.prepare('INSERT INTO subjects VALUES (@chatid, @prfnr)').run({chatid, prfnr})
}

function fillReportCard(subjects) {
    return 0;
}

/**
 * Gets subjects associated with CHATID from database. Terrible naming, as getSubjectsFromTable() is a function as well. TODO
 * @param {string, number} chatid 
 * @returns [number, string] // todo
 */
function getSubjects(chatid) {
    return db.prepare('SELECT * FROM subjects WHERE chatid = @chatid').all({chatid}).map( row => row.prfnr)
}

/**
 * 
 * @param {number} chatid 
 * @returns {number} message_id of pinned message
 */
function getPinnedMessage(chatid) {
    return db.prepare('SELECT pinned FROM users WHERE chatid = @chatid').get({chatid}).pinned
}

/**
 * TODO
 * @param {number} chatid 
 * @param {string, number} prfnr 
 * @returns 
 */
function removeSubjects(chatid, prfnr) {
    if (prfnr === undefined || chatid  === undefined) return console.log(`!!! ${getLogTime()} prfnr is undefined in removeSubjects()`)
    if (['number', 'string'].includes(typeof prfnr)) prfnr = [prfnr]

    return prfnr.map(
        prfnr => {
            let test = db.prepare('DELETE FROM subjects WHERE chatid = @chatid AND prfnr = @prfnr').run({chatid, prfnr})
            console.log(`!! ${getLogTime()} delete`, test);
            let success = test.changes
            // let success = db.prepare('DELETE FROM subjects WHERE chatid = @chatid AND prfnr = @prfnr').run({chatid, prfnr}).changes
            if (success > 0) return "Deleted " + prfnr
            else return "Couldn't find " + prfnr
        }
    ).join("\n")
}


/**
 * TODO WIP wanted to apply some form of partial function, but it's a hassle as well
 * Update row for primary key in specified table (all tables have one key in my case)
 * @param {string} table 
 * @param {f} pk 
 * @param  {...any} values 
 * @returns 
 */
// async function upsert(table, pk, ...values) {
//     let alldefined = arguments.reduce((prev, cur) => prev && (cur !== undefined), true);
//     if (!alldefined) console.log(`!!! ${getLogTime()} Not all arguments defined in upsert(). table: ${table}, pk: ${pk}, values: ${values}`)
    
//     if (typeof values === 'string') values = [values]
//     let upsert = `INSERT INTO ${table} 
//     VALUES (${values.map( () => '?').join(', ')})
//     ON CONFLICT (${pk})
//     DO UPDATE SET ${values.map((v, _) => `${v} = excluded.${v}`).join(', ')};`
//     return await db.prepare(upsert).run(values)
// }



