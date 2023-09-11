'use strict';
const assert = require('assert').strict;
const puppeteer = require('puppeteer');
const { Telegraf, Markup, session  } = require('telegraf');
const { createClient } = require('redis');
const fs = require('fs');
const readFileSync = fs.readFileSync;
const writeFileSync = fs.writeFileSync;
const OK = 'OK'; // todo

const DEBUG = process.env['DEBUG']
console.log('!! DEBUG: ', DEBUG)
const CHROMIUM_PATH = process.env['CHROMIUM_PATH'] ? process.env['CHROMIUM_PATH'] : '/usr/bin/chromium-browser'
console.log('!! Using CHROMIUM_PATH: ', CHROMIUM_PATH)

const client =  createClient();
client.on('error', err => console.log('Redis Client Error', err));
client.connect();

const {
    QIS_PASSWORD, QIS_USER, CHAT_ID, BOT_TOKEN, DEGREE, INTERVAL_SECONDS, STUDY_PROGRAM
} = initializeGlobal();

let EXAM_ID = []

// check if file exists
// TODO useless, will always be created so far to satisfy Docker build process. 
if (!fs.existsSync('exams.txt')) console.log('!! exams.txt does not exist, will infer from QIS')
else EXAM_ID = readFileSync('exams.txt', 'utf8') // Ignore PrfNr smaller than 1 digit, don't ask me why TODO
  .split('\n')
  .filter(i => i && i.length >= 1)

let lastheartbeat = -1;

const bot = initializeBot(BOT_TOKEN);
setTimeout( () => { // ugly but whatever. bot might not be ready yet. and wanted to keep bot const for fun.
    checkQIS(false)
    start(INTERVAL_SECONDS)
}, 5 * 1000)

async function checkQIS(upd) {
    try {   
        let {browser, page} = await getBrowser(CHROMIUM_PATH)

        await getToTable(page)
        const {subjects, update} = await getSubjects(page)
        
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
        
        if (update !== OK) console.log(`!!! ${getLogTime()} Update not OK: ${update}`)
        let { message, miscexams } = processSubjects(subjects)
            
        let lookingformsg = "Looking for:\n" + EXAM_ID.map(prf => {
            return subjects[prf] ? `${prf}: ${subjects[prf].title}` : `${prf}: not found`;
        }).join("\n");
        
        // upd = true if update was requested by user, thus send verbose message
        if (upd) {
            let verboseupdate = message + miscexams.trim() + "\n\n" + lookingformsg.trim() // Concrete update (bestanden, etc) + miscexams (angemeldet) +  Looking for: (PrfNr: Title) 
            await sendMessage(CHAT_ID, verboseupdate)
        }
        else if (message.length > 0) await sendMessage(CHAT_ID, message)
                
        heartbeat(CHAT_ID).catch(e => console.log('!!! ', e.stack, "Issue with heartbeat"))
        
        if (!DEBUG) writeFileSync('exams.txt', EXAM_ID.join('\n')); // Append and remove exams. IF DEBUG, don't write to file

        if (EXAM_ID.length === 0) { // todo check whether rest of exams are all junk
            console.log("!! Alle Klausuren wurden eingetragen.")
            sendMessage(CHAT_ID, "Alle Klausuren wurden eingetragen!")
            process.exit(0)
        }

    } catch(e) {
        console.log("!!! ", e.stack, "Issue with checkQIS()")
        closeBrowser(browser);
    }
    
}

/**
 * Sends a heartbeat after each QIS scrape that the bot is still alive, by editing the pinned message and updating the time.
 * @param {String, int} chatid 
 */
async function heartbeat(chatid) {
    if (DEBUG) return;
    if (!bot) console.log('!!! Bot is undefined in heartbeat')
    let pinned = await client.hGet(String(chatid), 'pinned')
    if (!pinned) {
        console.error('No pinned message found')
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
        
        console.log(`!! ${getLogTime()} Heartbeat sent`);
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
        console.log('!! Attempting browser.close()');
        
        let result = await Promise.race([
            browserInstance.close().then(() => 'closed'),
            new Promise(resolve => setTimeout(() => resolve('timeout'), 5 * 60 * 1000))
        ]);

        if (result === 'closed') {
            console.log('!! Browser closed successfully');
            return true;  // Indicate successful closure
        } else {
            console.log('!!! Timeout reached while trying to close browser');
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
    ['QIS_PASSWORD', 'QIS_USER', 'BOT_TOKEN', 'DEGREE', 'INTERVAL_MINUTES', 'STUDY_PROGRAM'] // CHAT_ID
        .forEach(key => assert(config[key] !== undefined, `Missing key ${key}`))

    config['INTERVAL_SECONDS'] = config['INTERVAL_MINUTES'] * 60;
    return config;
}

/**
 * Initializes the bot with all the required middleware
 * @param {String} BOT_TOKEN 
 * @returns {Telegraf} bot instance
 */
function initializeBot(BOT_TOKEN) {
    const bot = new Telegraf(BOT_TOKEN)
    console.log('!! Bot created')
    bot.start((ctx) => {
        (async () => {
            console.log(`!! ${getLogTime()} ${ctx.message.from.username} started the bot`)
            // it seems to be quite a brute-force approach that fails if there are no pinned messages. try-catch is the only way to go
            if (ctx.message.chat.id !== CHAT_ID) {}
            await bot.telegram.unpinAllChatMessages(CHAT_ID).catch((e) => console.log("!!! ", e.stack, "Unpinning failed"))
            await ctx.reply('Welcome! Write \'update\' to get started or press the big button below!', 
                Markup.keyboard([['🔍 Update']]).resize()
            )
            let message = await ctx.reply('Last updated: not yet 😶')
            
            bot.telegram.pinChatMessage(ctx.message.chat.id, message.message_id)
            await client.hSet(
                String(ctx.message.chat.id), 
                {
                    pinned: message.message_id
                }
            )
            await checkQIS(false)    
        })();
    })

    bot.on('message', (ctx, next) => {
        console.log(`!! ${getLogTime()} ${ctx.message.from.username} sent a message`);
        next();
    })

    bot.hears('hi', (ctx) => ctx.reply('Hey there 👋'))
    
    bot.hears(new RegExp('delete'), (ctx, next) => {
        let str = ctx.message.text.split('delete')[1].trim()
        if (EXAM_ID.indexOf(str) >= 0) {
            EXAM_ID.splice(EXAM_ID.indexOf(str), 1)
            ctx.reply(`Deleted ${str}`)
        } else {
            ctx.reply(`Could not find ${str}`)
        }
        next();
    })
    
    bot.hears(new RegExp('add'), (ctx, next) => {
        let str = ctx.message.text.split('add')[1].trim()
        if (EXAM_ID.indexOf(str) < 0) {
            EXAM_ID.push(str)
            ctx.reply(`Added ${str}`)
        } else {
            ctx.reply(`Already in list`)
        }
        next();
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
            checkQIS(true)
        }    
    )

    if (!DEBUG) {
        console.log('!! Launching bot')
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
    setInterval(() => {
        console.log(`!! ${getLogTime()} Starting interval Interval: ${INTERVAL_SECONDS}`)
        let date = new Date();
        let hour = date.getHours();
        
        if (hour >= 6 && hour <= 22) {
            console.log(`!! running (${getLogTime()}) ...`);
            checkQIS(false);
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
        console.log("Issue with page traversal", e.stack)
        closeBrowser(browser);
    }
}

/**
 * Processes the table and returns an object with all the subjects and their respective grades and states, with hopefully no dummy-entries
 * @param {puppeteer.Browser} page 
 * @returns {Object} {subjects: {key: {title, grade, state}}, update: "OK"} If all goes fine.
 */
async function getSubjects(page) {
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
 * @param {Object} subjects from the 'tbody' of QIS (getSubjects()) 
 * @returns {Object} {message: string, miscexams: string} 
 * message is the noteworthy message with at least one explicit update to be sent to the user on our own.
 * miscexams is a sanity check to see whether the bot is working and spits out all exams (among them are angemeldet and so on). used when user requests an update themselves.
 */
function processSubjects(subjects) {
    let message = ""
    let miscexams = "" // sanity check to check whether bot is working, spits out all + angemeldet exams
    
    Object.keys(subjects).forEach( key => {
        /**
         * @param state: [angemeldet, bestanden, nicht bestanden, nicht erschienen, verschoben]
         * @param title
         * @param grade
         */
        let subject = subjects[key]
        // Exam not in list yet
        if (EXAM_ID.indexOf(key) < 0) {
            if (subject.state === 'angemeldet') {
                EXAM_ID.push(key);
            }
            // else continue; // Only interested in 'unseen' exams that are angemeldet
        }
        // Exam in list
        else if (EXAM_ID.indexOf(key) >= 0) {
            switch(subject.state) { // So far, we only distinct between angemeldet (still need to track further) and everything else (can be deleted, no more tracking)
                case 'angemeldet':
                    miscexams += `${subject.title}:\n${subject.state}\n\n`;
                break;

                default: {
                    message += `${subject.title}:\n` + ((subject.grade.length) > 0 ? `${subject.grade} ` : '') + `${subject.state}\n\n`
                    EXAM_ID.splice(EXAM_ID.indexOf(key), 1); // safe to delete now
                    break;
                }
            }
        } 
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
    .catch(e => console.log('!!! ', e.stack, "Issue with sending message"))
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
            executablePath: CHROMIUM_PATH,   
            headless: process.env['NO_HEADLESS'] ? false : 'new' // use false for debugging
        })
        
        console.log(`!! browser PID: ${browser.process().pid}`)

        const page = await browser.newPage()
        console.log('!! newPage')

        await page.setViewport({
            width: 1024,
            height: 768
        });
        return {browser: browser, page: page}
    } catch(e){
        console.log(e.stack, "Issue with browser")
        closeBrowser(browser);
    }
}