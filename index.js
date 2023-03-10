'use strict';
import { readFileSync, writeFileSync } from 'fs';
import { launch } from 'puppeteer';
import { Telegraf } from 'telegraf';
import { assert } from 'console';

let CHROMIUM_PATH = '/usr/bin/chromium-browser'
// let not_final = ['angemeldet', 'verschoben'] // todo WIP - QIS might be not in German or other words might be used
// let final = ['bestanden', 'nicht bestanden']
const config = require('./config.json');
// import { QIS_PASSWORD as _QIS_PASSWORD, QIS_USER as _QIS_USER, CHAT_ID as _CHAT_ID, BOT_TOKEN as _BOT_TOKEN, BOT_API, DEGREE as _DEGREE, INTERVAL_MINUTES, STUDY_PROGRAM as _STUDY_PROGRAM } from './config.json';

assert(config.QIS_PASSWORD !== undefined)
assert(config.QIS_USER !== undefined)
assert(config.CHAT_ID !== undefined)
assert(config.BOT_TOKEN !== undefined) 
assert(config.DEGREE !== undefined)
assert(config.INTERVAL_MINUTES !== undefined)
assert(config.STUDY_PROGRAM !== undefined)

// pretty bad code
const QIS_PASSWORD = config.QIS_PASSWORD
const QIS_USER = config.QIS_USER
const CHAT_ID = config.CHAT_ID
const BOT_TOKEN = config.BOT_TOKEN
const DEGREE = config.DEGREE
const STUDY_PROGRAM = config.STUDY_PROGRAM
const INTERVAL_SECONDS = config.INTERVAL_MINUTES * 60

const bot = new Telegraf(BOT_TOKEN)

// Ignore PrfNr smaller than 3 digits
let EXAM_ID = readFileSync('exams.txt').toString().split("\n").filter( i => {
    if (i !== undefined) return i.length > 2;
    return false;
});
// console.log("Exams found: " + EXAM_ID.join(', '))
// debug = process.env.DEBUG
// ---------------------------
// let CHROMIUM_PATH = '/Applications/Chromium-puppeteer.app/Contents/MacOS/Chromium'
// ---------------------------
bot.start((ctx) => ctx.reply('Welcome'))
bot.on('sticker', (ctx) => ctx.reply('👍'))
bot.hears('hi', (ctx) => ctx.reply('Hey there'))
bot.hears('update', (ctx) => {
    run(true)
    ctx.reply('Coming right up')
})
bot.launch()
let browser;
let date = new Date(); // Used for initial start
console.log("We're live!")

run(false) 
setInterval(() => {
    date = new Date()
    let hour = date.getHours();
    if (hour >= 6 && hour <= 22) {
        console.log(`running (${date.toDateString() + " " +  date.toLocaleTimeString()}) ...`);
        run(false)
    }
}, INTERVAL_SECONDS * 1000)

async function run(upd) {
    try {
        let page;

        try {
            if (browser) browser.close();
            browser = await launch({args: [
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
                headless: true // use false for debugging
            })

            
            console.log('!! browser')

            page = await browser.newPage()
            console.log('!! newPage')

            await page.setViewport({
                width: 1024,
                height: 768
            });

            try {

                await page.goto('https://qis.verwaltung.uni-hannover.de/', { waitUntil: 'networkidle0'}) // TODO
                

                //  Login
                await page.type('input#asdf.input_login', QIS_USER)
                await page.type('input#fdsa.input_login', QIS_PASSWORD)
                await page.click('input.submit')
                
                // if (debug) console.log('logged in')
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
                
                // await page.waitFor(1000)

                await page.waitForXPath(`//table`)
                
                // console.log('table')


                // strs = await page.$$eval('tbody', (t, EXAM_ID) => {
                let ret;
                ret = await page.$$eval('tbody', (t, EXAM_ID) => {
                    let summary = []
                    let rm_exam = []
                    let found = []
                    let msg = 0
                    let logging = []

                    let rows;

                    if (t && t.length >= 2) {
                        t = t[1]
                        if (t) rows = t.rows
                        else return {rm_exam, summary, msg:"1tes"}
                    } else {
                        return {rm_exam, summary, found, msg:"2tes" }
                    }

                    for (let i = 0; i < rows.length; ++i) {
                        if (! (rows[i] && rows[i].cells) ) continue; //lel
                        if (rows[i].cells.length < 11) continue;
                        let cells = rows[i].cells

                        if (EXAM_ID.indexOf(cells[0].innerText) >= 0) {
                            // found.push(cells[1].innerText + cells[4].innerText + cells[5].innerText)
                            if (cells[5] && cells[5].innerText)

                            if (cells[5].innerText.valueOf() === "verschoben") continue

                            msg++;

                            found.push(cells[1].innerText + '\n' + ((cells[4].innerText === '') ? '' : cells[4].innerText + '\n') + cells[5].innerText)
                            if (cells[5].innerText.valueOf() !== 'angemeldet' && cells[5].innerText.valueOf() !== 'verschoben') {
                                summary.push(cells[1].innerText + '\n' + cells[4].innerText + '\n' + cells[5].innerText + '\n--------\n')
                                rm_exam.push(cells[0].innerText)
                            }
                        }
                    }
                    // Falls Klausur nicht bestanden + angemeldet, soll das kein Update darstellen.
                    for (let i = 0; i < rows.length; ++i) {
                        if (! (rows[i] && rows[i].cells) ) continue; //lel
                        if (rows[i].cells.length < 11) continue;
                        let cells = rows[i].cells
                        if (!(rm_exam.indexOf(cells[0].innerText) >= 0)) continue;
                        if (cells[5].innerText.valueOf() === "angemeldet" || cells[5].innerText.valueOf() === "bestanden") {
                            while (rm_exam.indexOf(cells[0].innerText) >= 0) {
                                let to_ignore = rm_exam.indexOf(cells[0].innerText)
                                rm_exam.splice(to_ignore, 1);
                                summary.splice(to_ignore, 1)
                                found.splice(to_ignore, 1)
                                msg--;
                                logging.push(cells[1].innerText + " ist: " + cells[5].innerText)
                            }
                        if (cells[5].innerText.valueOf() === "bestanden"){
                            summary.push(cells[1].innerText + '\n' + cells[4].innerText + '\n' + cells[5].innerText + '\n--------\n')
                            found.push(cells[1].innerText + '\n' + ((cells[4].innerText === '') ? '' : cells[4].innerText + '\n') + cells[5].innerText)
                            rm_exam.push(cells[0].innerText)
                        }
                        }
                    }
                    
                    return {rm_exam, summary, found, msg: ("found:" + msg), logging}
                }, EXAM_ID)
                    .then( ret => {
                        browser.close()
                        return ret
                    })
                date.getTime().toString()
                console.log(`Qis: (${date.toDateString() + " " +  date.toLocaleTimeString()}) ` + ret.msg + " - " + ret.summary.join(', ') + ret.logging.join(', ') )

                if (upd) await bot.telegram.sendMessage(CHAT_ID, ret.found.join('\n------\n') + '\n' + (ret.found.length > 0 ? '' : 'Whoops'))

                ret.found = ret.found.map( s => {
                    if (s) return s.length
                    else return 0
                })

                // console.log(`Qis: (${moment().format()}) ` + ret.found.join(',') + ' - ' + ret.msg)


                // if (debug) console.log('tbody')
 
                if (ret.rm_exam.length !== 0) {
                    try {
                        await bot.telegram.sendMessage(CHAT_ID, ret.summary.join('\n'))
                    }
                    catch(e){
                        console.log(e, "Telegram problem")
                        await browser.close()
                    }
                    for (let i=0; i< ret.rm_exam.length; i++) {
                        if (EXAM_ID.indexOf(ret.rm_exam[i]) >= 0) EXAM_ID.splice(EXAM_ID.indexOf(ret.rm_exam[i]), 1);
                    }
                    writeFileSync('exams.txt', EXAM_ID.join('\n'));
                    // console.log(ret.summary.join('\n'))
                }

                if (EXAM_ID.length === 0) {
                    console.log("Alle Klausuren wurden eingetragen.")
                    process.exit(0)
                }
            }
            catch (e) {
                try {
                    console.log("Issue with QIS\n" + e)
                    // await (await page.$x('//a[text()="Abmelden"]'))[0].click()
                    // await page.waitForXPath('//h3[text()="Sicherheitshinweis - bitte sorgfältig lesen!"]')
                    await browser.close()
                    // bot.telegram.sendMessage(CHAT_ID, e)
                }
                catch (e) {
                    console.log("Catched in c1", e)
                }
            }
        } catch(e){
            console.log(e, "Issue with browser")
            await browser.close()
        }
    }
    catch (e) {
        console.log(e + `at (${date.toDateString() + " " +  date.toLocaleTimeString()}) ...`)
    }
}