## What is this?
This script scrapes your university's QIS page every set amount of minutes and notifies you via Telegram about the grades that got finally entered.
I initially forked/modified the project by [friedPotat0](https://github.com/friedPotat0/QIS-Scraper), which helped me to get into JS/Puppeteer.

The script itself is a Node.js script running inside a Docker container. Because it relies on the JS library Puppeteer together with Chromium in order to scrape the grades, you need a 64-Bit Raspberry Pi. Other than that, it should run anywhere you want and does so very reliably on my Raspberry Pi 4 8GB. I tried an afternoon implementing the script to work with Firefox in order to make it work with 32-Bit systems, but puppeteer behaves really badly with it. Firefox crashes due to CSP when traversing the site, but turning it off via `page.setBypassCSP(true)` crashes the script immediately - doesn’t seem to work with Firefox. Going the way with document.evaluate is quite cumbersome, so I set it aside.

## How to use it
There is almost zero work you need to put in to make it all work, assuming you are at the Leibniz University Hannover as well. If you are not, modifying the page traversal logic should be straight forward, if you are don't mind playing with the browser's inspect element for a couple of minutes.

## Telegram Bot setup
You need to create a Telegram Bot at first. This is easily done; simply find the user **@botfather** on Telegram and write him `\newbot`. You will be guided through the setup process, which is very simple. At the end, you will receive a token which you need for the further steps.

Because the bot has to be able to contact you and can't look you up by your user-ID or phone number, you need to get your chat-ID. This is also very easy to do. Simply write the bot you just created a message and then go to the following URL:
`https://api.telegram.org/bot<##YOUR TOKEN GOES HERE>/getUpdates` - mind the prepending **bot**, don't use the <,> though! Example: `https://api.telegram.org/botABCDEEHEFKF/getUpdates`.
You will receive a JSON response, which contains your chat-ID (an integer) near your username - copy it and paste it into the `config.json`.

# Setup
When all is done, the rest is super easy.
1. Enter all the information required into the `config.json`. Should you need help with that, you will find explanations at the absolute bottom of this page.
2. You can skip this step most likely, as the bot will now infer the exams on its own and send you the ones it found - and you can also send the bot messages with "add Prf.Nr." or "delete Prf.Nr.". But for completeness sake, I will keep it. Then, fill in your "PrfNr" into your `exams.txt` - after each "PrfNr" press enter. Example screenshots can be found at the bottom.
3. On the Raspberry Pi I had to run `sudo loginctl enable-linger $USER` in order to make the container stay alive after you sign out. I don't know if this is necessary on other systems. Docker ran fine without it, but Podman didn't.
4. Run `build.sh` from the current folder, which should take care of building and registering it as a SystemD service and so on. To do that: Traverse into the folder (by ie `cd qispi`) and then run i.e. `sh build.sh`. Don't run it under sudo please, because podman works well without it. If some command needs sudo for you, please open an issue to let me know and run the lines manually with sudo when needed (especially if your system does not utilize SystemD).
5. If you need help or something doesn't work for you, please open an issue. I will try to help you as best as I can.
6. Read the Advice section!

# Advice
## 0:
don't use podman with sudo

## 1
Use `lazydocker`, as it works well with podman and is very convenient.
`systemctl --user enable podman.socket`
`systemctl --user start podman.socket`

then insert into .bashrc or whatever shell you are using
`alias lazypodman='DOCKER_HOST=unix:///run/user/1000/podman/podman.sock lazydocker'`

## 2: dont track private config.json file
If you want to contribute somehow or test something, please make sure to not track your private config.json file. To do that, run 
`git update-index --assume-unchanged config.json`

# To-Do
- The logging definetly needs improvement.
- Firefox (for 32-Bit devices) would be great, but I don't think it's possible with puppeteer.
- I'd like to allow others to use this, if they are willing to share their passwords which would be stored in the already working Redis instance. But this idea needs a lot more thought.
- Make the Redis DB useful somehow else. Sessioning doesn't really help with anything thus far and the absolutely rudimentary usage of the DB is quite a shame. Will store EXAMS there, when I get to it.

## This will be needed for the future
Because puppeteer doesn't work well with Chrom{e,ium} versions it is not automatically shipped with, those websites can help in the future to find the correct versions. Also helpful for local testing of the script on main machine.
- https://vikyd.github.io/download-chromium-history-version/#/
- https://pptr.dev/faq/#q-which-chromium-version-does-puppeteer-use
- debuggin `podman events --filter type=container > ~/qispi/logging 2>&1 &`

## How-to config.json
- "QIS_PASSWORD": the password you log in with; hopefully there is no SSO or similar at your uni.
- "QIS_USER": The ID you login with. At LUH, it's something like "9AB-CDE".
- "CHAT_ID": See the Telegram Bot setup section.
- "BOT_TOKEN": See the Telegram Bot setup section.
- "DEGREE": The degree you are studying. It's the top level selection, at least at the LUH. Something like "Psychology Bachelor".
- "STUDY_PROGRAM": The 2nd level selection, right before you see your grades overview. Hopefully this is not different at your university or else you would need to uncomment a little bit of code, should be easy enough.
- "INTERVAL_MINUTES": The interval in minutes the script should check for new grades. Please try to be considerate and don't set it to less than 15 mins. I am confident that if you are using the script, you are not the only one and I don't want them to force Captcha or whatever upon us.

<img width="535" alt="study" src="https://github.com/arkov/qisPi/assets/9944846/acb74151-f66f-403b-bad4-c5159b9362af">


## How-to exams.txt
Use the PrfNr of the row in which your grade will be displayed.

<img width="524" alt="row" src="https://github.com/arkov/qisPi/assets/9944846/4f1d032c-98d1-4b1d-8438-0c8685c575e1">

