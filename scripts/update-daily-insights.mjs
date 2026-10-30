import { updateNews } from './news.mjs';
console.log(JSON.stringify(await updateNews(), null, 2));
