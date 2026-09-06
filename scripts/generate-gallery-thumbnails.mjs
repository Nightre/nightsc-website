import { readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const sourceDirectory = path.resolve('public/hua');
const outputDirectory = path.join(sourceDirectory, 'thumbs');
const thumbnailWidth = 960;
const thumbnailQuality = 72;

await mkdir(outputDirectory, { recursive: true });

const sourceFiles = (await readdir(sourceDirectory, { withFileTypes: true }))
	.filter((entry) => entry.isFile() && /^\d+\.png$/i.test(entry.name))
	.map((entry) => entry.name)
	.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

if (sourceFiles.length === 0) {
	console.log(`No PNG files found in ${sourceDirectory}`);
	process.exit(0);
}

await Promise.all(
	sourceFiles.map(async (fileName) => {
		const outputName = `${path.parse(fileName).name}.webp`;
		await sharp(path.join(sourceDirectory, fileName))
			.resize({ width: thumbnailWidth, withoutEnlargement: true })
			.webp({ quality: thumbnailQuality, smartSubsample: true })
			.toFile(path.join(outputDirectory, outputName));
		console.log(`Generated ${path.join('public/hua/thumbs', outputName)}`);
	}),
);
