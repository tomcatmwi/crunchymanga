import * as fs from 'fs';
import { fatalError, base64toImage, deleteOutput, dump } from './utils.js';
import inquirer from 'inquirer';
import { LocalStorage } from 'node-localstorage';
import sanitize from 'sanitize-filename';
import imgToPDF from 'image-to-pdf';
import * as path from 'path';
import fetch from 'node-fetch';
import * as jimp from 'jimp';
import Epub from 'epub-gen';

import { Builder, Browser, By, Key, until } from 'selenium-webdriver';

const localStorage = new LocalStorage('./localstorage');

console.log(`CrunchyManga 1.0 by TomcatMWI - A handy utility to save mangas on your device!`);

//  Query parameters

  const browserChoices = ['Chrome', 'Firefox', 'Edge', 'Opera'];
  const formatChoices = ['Images - each page is a JPEG file', 'PDF file', 'EPUB file', 'Both PDF and EPUB'];
  const divideChaptersChoices = ['Single file', 'Every 20 chapters into a new file', 'Every 10 chapters into a new file', 'Every 5 chapters into a new file', 'Every single chapter into a new file'];

  const params = await inquirer.prompt([
  {
    type: 'input',
    name: 'username',
    default: localStorage.getItem('crunchyroll_username'),
    message: 'Enter your Crunchyroll username:',
    validate(value) {
      if (value.length > 3)
        return true
      throw Error('This doesn\'t seem to be a valid username.');
    }
  },
  {
    type: 'password',
    name: 'password',
    default: localStorage.getItem('crunchyroll_password') || null,
    message: `Enter your Crunchyroll password ${localStorage.getItem('crunchyroll_password') ? '(press Enter to use saved password)' : ''}:`,
    validate(value) {
      if (value.length > 3)
        return true
      throw Error('This doesn\'t seem to be a valid password.');
    }
  },
  {
    type: 'input',
    name: 'url',
    message: 'Enter URL of the Crunchyroll manga:',
    default: localStorage.getItem('crunchyroll_url'),
    validate(value) {
      if ((/^https:\/\/(www\.)?crunchyroll.com\/comics\/manga\/(.*)\/volumes$/ig).test(value))
        return true
      throw Error('Invalid URL. The correct format is: https://crunchyroll.com/comics/manga/MANGA_TITLE/volumes');
    }
  },
  {
      type: 'rawlist',
      name: 'browser',
      message: 'Which browser shall we use?',
      default: localStorage.getItem('crunchyroll_browser'),
      choices: browserChoices
  },
  {
      type: 'rawlist',
      name: 'format',
      message: 'How shall we save the manga?',
      default: localStorage.getItem('crunchyroll_format'),
      choices: formatChoices
  },
  {
      type: 'rawlist',
      name: 'pdf_pagesize',
      message: 'PDF page size?',
      default: localStorage.getItem('crunchyroll_pdf_pagesize') || 'LETTER',
      choices: Object.keys(imgToPDF.sizes),
      when: answers => answers.format === formatChoices[1] || answers.format === formatChoices[3]
  },
  {
      type: 'rawlist',
      name: 'divideChapters',
      message: 'Divide export file?',
      default: localStorage.getItem('crunchyroll_divideChapters'),
      choices: divideChaptersChoices,
  },
  {
      type: 'rawlist',
      name: 'consent',
      message: 'Go ahead with the above settings?',
      choices: ['Yes', 'No']
  }
  ]).catch(err => fatalError(err.message));

  if (params.consent === 'No')
    fatalError('User abort! Maybe next time...');

  localStorage.setItem('crunchyroll_username', params.username);
  localStorage.setItem('crunchyroll_password', params.password);
  localStorage.setItem('crunchyroll_url', params.url);
  localStorage.setItem('crunchyroll_browser', params.browser);
  localStorage.setItem('crunchyroll_format', params.format);
  localStorage.setItem('crunchyroll_pdf_pagesize', params.pdf_pagesize || 'LETTER');

//  Launch browser and navigate to Crunchyroll

let browser = [Browser.CHROME, Browser.FIREFOX, Browser.EDGE, Browser.OPERA][browserChoices.findIndex(x => x === params.browser)];

(async () => {
  try {

    //  We will store the structure into this
    const mangaData = {
      publisher: '',
      firstPublished: '',
      author: '',
      artist: '',
      copyright: '',
      translator: '',
      editor: '',
      letterer: '',
      title: '',
      cover: '',
      chapterDivide: 0,
      chapters: []
    }

    //  Set chapter division
    switch(params.divideChapters) {
      case divideChaptersChoices[1]:
        mangaData.chapterDivide = 20;
        break;
      case divideChaptersChoices[2]:
        mangaData.chapterDivide = 10;
        break;
      case divideChaptersChoices[3]:
        mangaData.chapterDivide = 5;
        break;
      case divideChaptersChoices[5]:
        mangaData.chapterDivide = 1;
        break;   
      default: 
        mangaData.chapterDivide = 0;
    }

    //  Load Crunchyroll
    const driver = await new Builder().forBrowser(browser).build();
    await driver.get('https://crunchyroll.com');

    //  Click user profile icon
    const profileButton = By.xpath(`/html/body/div[1]/div/div[1]/div[1]/div[3]/ul/li[4]/div/div[1]`);
    await driver.wait(until.elementLocated(profileButton));
    await driver.findElement(profileButton).click();

    //  Click login link
    const loginLink = By.xpath(`//h5[contains(text(), 'Log In')]`);
    await driver.wait(until.elementLocated(loginLink));
    await driver.findElement(loginLink).click();

    //  Click 'Reject all non-essential cookies'
    const cookieButton = By.id('_evidon-decline-button');
    await driver.wait(until.elementLocated(cookieButton));
    await driver.findElement(cookieButton).click();

    //  Type in username and password, then click LOG IN
    const usernameField = By.xpath(`//input[@name='username']`);
    const passwordField = By.xpath(`//input[@name='password']`);
    await driver.wait(until.elementLocated(usernameField));
    await driver.wait(until.elementLocated(passwordField));
    await driver.findElement(usernameField).sendKeys(params.username);
    await driver.findElement(passwordField).sendKeys(params.password);
    await driver.findElement(By.xpath(`//button[contains(text(), 'LOG IN')]`)).click();

    //  Wait for main page to load, then go to manga
    await driver.wait(until.elementLocated(By.xpath(`//span[contains(text(), 'Log Out')]`)));
    await driver.wait(until.elementLocated(cookieButton));
    await driver.findElement(cookieButton).click();

    //  Go to manga main page and get author info
    console.log('Getting manga data...');

    await driver.get(params.url);

    await driver.wait(async () => {
      const errors = await driver.findElements(By.xpath(`//p[contains(text(), 'We are sorry. A team of shinobi is working to bring your anime back. Thank you for your patience.')]`));
      const content = await driver.findElements(By.xpath(`//h3[contains(text(), 'More Information')]`));
      
      if (!!content.length)
        return true;

      if (!!errors.length) {
        await driver.get(params.url);
        return false;
      }
    }, 60000, 'Page load timed out', 2000);

    const infoLines = await driver.findElements(By.xpath(`/html/body/div[2]/div/div[1]/div[3]/div/div[3]/ul/li[3]/ul/li`));
    for (const [index, line] of infoLines.entries()) {
      const dataLine = await line.getAttribute('innerHTML');
      mangaData[Object.keys(mangaData)[index]] = dataLine.replace(/<(.*)>/gi, "").trim();
    }
    
    //  Get whether the right or the left carousel arrow is active
    const clickArrow = async (side) => {
      let arrow = By.xpath(`//a[contains(@class, 'collection-carousel-${side}arrow')]`);
      await driver.wait(until.elementLocated(arrow));
      const arrowElement = await driver.findElement(arrow);
      const arrowClasses = await arrowElement.getAttribute('class');

      if (arrowClasses.includes('disabled'))
        return;

      await arrowElement.click();
      await driver.wait(async () => !(await arrowElement.getAttribute('class')).includes('loading'));
      await clickArrow(side);
    }

    //  Click all the way left and right
    await clickArrow('left');
    await clickArrow('right');

    //  Now we lazy loaded all thumbnails, let's get their content
    let chaptersXpath = By.xpath(`//div[contains(@class, 'collection-carousel-scrollable')]//a[contains(@class, 'block-link')]`);

    await driver.wait(until.elementsLocated(chaptersXpath));
    const chapters = await driver.findElements(chaptersXpath);
        
    for(const chapter of chapters) {
      mangaData.chapters.push({
        title: await chapter.getAttribute('title'),
        url: await chapter.getAttribute('href'),
        pages: []
      });
    }

    console.log(`This manga has ${mangaData.chapters.length} chapters.`);

    //  Save cover image URL
    const coverXpath = By.xpath(`//img[contains(@class, 'poster')]`);
    await driver.wait(until.elementLocated(coverXpath));
    mangaData.cover = await driver.findElement(coverXpath).getAttribute('src');

    //  Go to manga reader
    await driver.get(mangaData.chapters[0].url);
    
    //  Retry for 1 minute if we got the error page
    await driver.wait(async () => {
      const errors = await driver.findElements(By.xpath(`//p[contains(text(), 'We are sorry. A team of shinobi is working to bring your anime back. Thank you for your patience.')]`));
      const content = await driver.findElements(By.id('manga_reader'));
      
      if (!!content.length)
        return true;

      if (!!errors.length) {
        await driver.get(mangaData.chapters[0].url);
        return false;
      }
    }, 60000, 'Page load timed out', 5000);

    //  Get manga title
    mangaData.title = await driver.findElement(By.xpath(`//header[@class='chapter-header']//a`)).getText();

    //  Create save directory
    const outDir = path.join(process.cwd(), 'output', sanitize(mangaData.title));
    console.log(`Output directory: "${outDir}"`);

    if (fs.existsSync(outDir))
        await deleteOutput(outDir)
    else
        fs.mkdirSync(outDir);

    //  Download cover image
    console.log(`Cover image: ${mangaData.cover}`);
    const coverResponse = await fetch(mangaData.cover, { method: 'GET' });
    const coverBlob = await coverResponse.blob();
    const coverPath = path.join(outDir, 'cover.jpg');
    fs.writeFileSync(coverPath, Buffer.from(await coverBlob.arrayBuffer()), 'binary');
    mangaData.cover = coverPath;

//  -----------------------------------------------------------------------------------------------------------
//    Recursive chapter reader
//  -----------------------------------------------------------------------------------------------------------

    let currentChapter = 0;
    const getCurrentChapter = async () => {

      console.log(`Now downloading ${mangaData.chapters[currentChapter].title}...`);

      //  Load manga page
      if (currentChapter > 0) {
        await driver.get(mangaData.chapters[currentChapter].url);

        //  Retry for 1 minute if we got the error page
        await driver.wait(async () => {
          const errors = await driver.findElements(By.xpath(`//p[contains(text(), 'We are sorry. A team of shinobi is working to bring your anime back. Thank you for your patience.')]`));
          const content = await driver.findElements(By.id('manga_reader'));
          
          if (!!content.length)
            return true;

          if (!!errors.length) {
            await driver.get(mangaData.chapters[currentChapter].url);
            return false;
          }
        }, 60000, 'Page load timed out', 5000);
      }

      //  Pull scroll bar to page 1
      const barXpath = By.xpath(`/html/body/div[2]/div/div[1]/section/div/article/header/div/input`);
      await driver.wait(until.elementLocated(barXpath), 20000);
      const bar = await driver.findElement(barXpath);
      await bar.click();
      await driver.sleep(3000);
      await bar.sendKeys(Key.HOME);
      await driver.sleep(3000);

      //  Start from page 1
      let page = 1;
      const imageXpath = By.xpath(`//ol/li`);
      await driver.wait(until.elementsLocated(imageXpath));
      const images = await driver.findElements(imageXpath);

      console.log(`Found ${images.length} pages.`);

      const getCurrentPages = async () => {
        console.log(`Retrieving ${mangaData.chapters[currentChapter].title}, page ${page}...`);
        const image = images[page-1];

          //  Wait until the image has a background-image tag
          await driver.wait(
            (async () => await image.getCssValue('background-image') !== 'none'), 10000
          );

          //  Get background image
          const background = await image.getCssValue('background-image');

          if (background !== 'none') {
            
              //  Check if this is a double page (width > height)
              let pageImage = await jimp.default.read(base64toImage(background));
              const pageWidth = pageImage.getWidth();
              const pageHeight = pageImage.getHeight();

              //  If double, cut it into two files
              if (pageWidth > pageHeight) {
                const halfWidth = Math.round(pageWidth / 2);

                //  Save double images into two pages
                const outputFile1 = path.join(outDir, `${String(currentChapter).padStart(3, '0')}_p${String(page).padStart(3, '0')}.jpg`);
                await pageImage.crop(halfWidth, 0, (pageWidth - halfWidth), pageHeight).write(outputFile1);
                mangaData.chapters[currentChapter].pages.push(outputFile1);
                page++;

                pageImage = await jimp.default.read(base64toImage(background));
                const outputFile2 = path.join(outDir, `${String(currentChapter).padStart(3, '0')}_p${String(page).padStart(3, '0')}.jpg`);
                await pageImage.crop(0, 0, Math.round(pageWidth / 2), pageHeight).write(outputFile2);
                mangaData.chapters[currentChapter].pages.push(outputFile2);

              } else {

                //  Save single page image
                const outputFile = path.join(outDir, `${String(currentChapter).padStart(3, '0')}_p${String(page).padStart(3, '0')}.jpg`);
                pageImage.write(outputFile);
                mangaData.chapters[currentChapter].pages.push(outputFile);
              }

              page++;

              //  Turn page if needed
              if (page === 1 || page % 2 !== 0) {
                const btnPath = By.xpath(`//a[contains(@class, 'js-next-link')]`);
                await driver.wait(until.elementLocated(btnPath));
                const button = await driver.findElement(btnPath);
                await button.click();
              }

              //  If there are more pages, get the next one
              if (page <= images.length)
                await getCurrentPages()
              else {
                  //  If no more pages, go to next chapter
                  console.log(`All pages finished!`);
                  currentChapter++;
                  if (currentChapter < mangaData.chapters.length)
                    await getCurrentChapter();
              }

          } else
            console.error(`Image in chapter ${mangaChapter} page ${page} cannot be loaded!`);
      }      

      await getCurrentPages();
    }

    //  The download loop!
    await getCurrentChapter();

    //  Thanks, browser, you can now go
    await driver.quit();

//  -----------------------------------------------------------------------------------------------------------
//    Process downloaded data
//  -----------------------------------------------------------------------------------------------------------

    //  Done - let's save it... or not... depends on the settings
    if (params.format === formatChoices[0]) {
      console.log('All done! Bye!');
      process.exit(0);
    }

    //  Convert downloaded images to PDF
    if (params.format === formatChoices[1] || params.format === formatChoices[3]) {
      console.log('Exporting to PDF...');

      const pdfImages = [mangaData.cover];
      let lastEndChapter = 0;

      mangaData.chapters.forEach((chapter, index) => {
        pdfImages.push(...chapter.pages);

        if (index > 0 && (
          (mangaData.chapterDivide > 0 && index % mangaData.chapterDivide === 0) || 
          index === mangaData.chapters.length-1)
        ) {

          imgToPDF(pdfImages, imgToPDF.sizes[params.pdf_pagesize])
            .pipe(fs.createWriteStream(
              path.join(process.cwd(), 'output', sanitize(mangaData.title) + ` - ${String(lastEndChapter+1).padStart(3, '0')}-${String(index).padStart(3, '0')}.pdf`)
            ));
            
          pdfImages.length = 0;
          lastEndChapter = index;
        }
      });
    }

    //  Convert downloaded images to EPUB
    if (params.format === formatChoices[2] || params.format === formatChoices[3]) {
      console.log('Exporting to EPUB...');

      const content = [];
      let lastEndChapter = 0;
      let index = 0;
      let volume = 1;

      do {
        const chapter = mangaData.chapters[index];

        let data = '';
        chapter.pages.forEach((page, pageIndex) => data += `<img src="${page}" title="${mangaData.title} - ${chapter.title} - Page ${pageIndex+1}" style="page-break-after: always;"/>`);
        content.push({
            title: chapter.title,
            index,
            data
        });

        if (index > 0 && (
          (mangaData.chapterDivide > 0 && (index+1) % mangaData.chapterDivide === 0) || 
          index === mangaData.chapters.length-1)
        ) {
    
          const epubContent = {
                  index,
                  title: `${mangaData.title} - Volume ${volume}.`,
                  author: (!!mangaData.author ? mangaData.author : mangaData.artist) || 'Unknown',
                  publisher: mangaData.publisher,
                  cover: mangaData.cover,
                  content,
                  version: 3,
                  css: fs.readFileSync(path.join(process.cwd(), 'epub.css'), 'utf-8'),
                  tocTitle: mangaData.title,
                  appendChapterTitles: false
              };

            let filename = content.length > 1 
            ? 
            ` - ${String(content[0].index+1).padStart(3, '0')}-${String(index+1).padStart(3, '0')}.epub`
            :
            `- ${String(index+1).padStart(3, '0')}.epub`;

            filename = path.join(process.cwd(), 'output', sanitize(mangaData.title) + filename);
            
            await new Epub(epubContent, filename).promise;

            content.length = 0;
            lastEndChapter = index;
            volume++;
        }

        index++;
      } while (index < mangaData.chapters.length);

//  ---------------------------------------------------------------------------------------------------------------
    }

    deleteOutput(outDir, true);

  } catch(err) {
    if (typeof driver !== 'undefined')
      await driver.quit();
    fatalError(err.message);
  } finally {
    console.log('All done! Bye!');
  }
  
})();
