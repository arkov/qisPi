# Code is primarily copied from below linked repo and also hacky - at least my modifications :)

## [Fork of:](https://github.com/friedPotat0/QIS-Scraper) 
[https://github.com/friedPotat0/QIS-Scraper](https://github.com/friedPotat0/QIS-Scraper)

## What is this?
This script scrapes your university's QIS page every n minutes and notifies you via Telegram about the grades that got finally entered.

The script itself is a Node.js script running inside a Docker container. Because it relies on the JS library Puppeteer together with Chromium in order to scrape the grades, you need a 64-Bit Raspberry Pi. Other than that, it should run anywhere you want and very reliably on my Raspberry Pi 4 8GB.

## How to use it
There is only very little manual work you need to do in order to get going (at least when youre at the Leibniz University Hannover) - that is to get the Telegram Bot set up. Other than that, you pass very easy to acquire information in the config.json, and you're good to go. In case you are from a different university, you might need to change the code a little bit - mostly the XPaths of the login fields and so on. I'd guess maybe 10 minutes of work, if you are familiar with your browser's inspect element :D.

## Telegram Bot setup
You need to create a Telegram Bot at first. THis is easily done; simply find the user **@botfather** on Telegram and write him `\newbot`. You will be guided through the setup process, which is very simple. At the end, you will receive a token which you need for the further steps.

Because the bot has to be able to contact you and can't look you up by your user-ID or phone number, you need to get your chat-ID. This is also very easy to do. Simply write the bot you just created a message and then go to the following URL:
`https://api.telegram.org/bot<###YOURBOTTOKENGOESHERE###>/getUpdates` - mind the prepending **bot**! You will receive a JSON response, which contains your chat-ID (an integer) near your username - copy it and paste it into the config.json.

# Setup
When all is done, the rest is super easy.
1. Enter all the information required into the `config.json`. Should you need help with that, you will find explanations at the bottom.

2. Then, fill in your "PrfNr" into your `exams.txt` - after each "PrfNr" press enter. Example screenshots can be found at the bottom.

3. Build the docker image. Traverse into the folder (by ie `cd qispi`) and then run `docker build -t qisbot .`. Potentially you need sudo, depends on the distro.

4. When all went well, start the bot with `docker run \
   -e TZ=Europe/Berlin \
   --restart always \
   -v /home/pi/qispi/exams.txt:/usr/src/app/exams.txt \
   -v /home/pi/qispi/config.json:/usr/src/app/config.json \
   --init -d --cap-add=SYS_ADMIN \
   qispi`
5. If not, open an issue :) 

### Advice
Install Lazydocker and then run ` sudo docker build -t qispi . ; sudo docker run \
-e TZ=Europe/Berlin \
--restart always \
-v /home/pi/qispi/exams.txt:/usr/src/app/exams.txt \
-v /home/pi/qispi/config.json:/usr/src/app/config.json \
--init -d --cap-add=SYS_ADMIN \
qispi ; sudo lazydocker `
Lazydocker is very convenient to check the doing of the bot without typing all the fun commands into the terminal.

### This will be needed for the future
Because puppeteer doesn't work well with Chrom{e,ium} versions it is not automatically shipped with, those websites can help in the future to find the correct versions. Also helpful for local testing of the script on main machine.
- https://vikyd.github.io/download-chromium-history-version/#/
- https://pptr.dev/faq/#q-which-chromium-version-does-puppeteer-use


### How-to config.json
- "QIS_PASSWORD": the password you log in with, hopefully there is no SSO or similar at your uni.
- "QIS_USER": The ID you login with. At LUH, it's something like "9AB-CDE".
- "CHAT_ID": See the Telegram Bot setup section.
- "BOT_TOKEN": See the Telegram Bot setup section.
- "DEGREE": The degree you are studying. It's the top level selection, at least at the LUH. Something like "Psychology Bachelor".
- "STUDY_PROGRAM": The 2nd level selection, right before you see your grades overview. Hopefully this is not different at your university or else you would need to uncomment a little bit of code, should be easy enough.
- "INTERVAL_MINUTES": The interval in minutes the script should check for new grades. I think 15 minutes is reasonable enough, you shouldn't use a smaller interval as the code is not optimized for that.
<img width="535" alt="Degree/Study Program" src="https://user-images.githubusercontent.com/9944846/224445001-fdf48a2c-5c54-444a-9ec1-646be61d91c2.png">



### How-to exams.txt
Use the PrfNr of the row in which your grade will be displayed.
<img width="524" alt="Prfnr" src="https://user-images.githubusercontent.com/9944846/224444955-b9cd5dff-163c-4cbf-ac63-643b213ade39.png">

