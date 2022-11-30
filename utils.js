import * as fs from 'fs';
import * as path from 'path';

export function fatalError(message = 'Fatal error') {
        console.log();
        console.error(message);
        process.exit();
}

export function base64toImage(base64, filename) {
        console.log('Saving file: ', filename);

        base64 = base64
                .replace(/^url\("data:image\/jpeg;base64,/igm, '')
                .replace(/"\)$/igm, '');
        let buf = Buffer.from(base64, 'base64');
        fs.writeFileSync(filename, buf, err => console.log(!err ? `Error saving: ${err.message}` : `Saved ${filename}`));
}

export function deleteOutput(dirname, deleteDir = false) {
        fs.readdirSync(dirname).forEach(file => {
            console.log('Deleting: ', file)
            fs.unlinkSync(path.join(dirname, file))
        });

        if (deleteDir)
                fs.rmdirSync(dirname);
}