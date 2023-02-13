import { Hono } from 'hono';
import { cors } from 'hono/cors';
const router = new Hono();

let env;
const cache = caches.default;

function jsonResponse(json, statusCode = 200){
	if(typeof(json) !== 'string') json = JSON.stringify(json);
	return new Response(json, {
		headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Max-Age': '86400' },
		status: statusCode
	});
}

async function generateHash(message){
	const msgUint8 = new TextEncoder().encode(message);
	const hashBuffer = await crypto.subtle.digest('SHA-512', msgUint8);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function setValue(key, value, expirationTime = null, cacheTime = 60){
	let cacheKey = "https://api.rabbitsearch.org?key=" + key;
	if(expirationTime === null){
		await env.KV.put(key, value);
	}else{
		await env.KV.put(key, value, { expirationTtl: expirationTime });
	}
	let nres = new Response(value);
	nres.headers.append('Cache-Control', 's-maxage=' + cacheTime);
	await cache.put(cacheKey, nres);
}

async function getValue(key, cacheTime = 60){
	let value = null;

	let cacheKey = "https://api.rabbitsearch.org?key=" + key;
	let res = await cache.match(cacheKey);
	if(res) value = await res.text();

	if(value == null){
		value = await env.KV.get(key, { cacheTtl: cacheTime });
		let nres = new Response(value);
		nres.headers.append('Cache-Control', 's-maxage=' + cacheTime);
		if(value != null) await cache.put(cacheKey, nres);
	}

	return value;
}

async function deleteValue(key){
	await env.KV.delete(key);
	await cache.delete("https://api.rabbitsearch.org?key=" + key);
}

async function search(query, type = 'general'){
	let secretKey = env.BING_SEARCH_KEY;
	let endpoint = "https://api.bing.microsoft.com/v7.0/search?";

	if(type === 'images'){
		secretKey = env.BING_IMAGES_KEY;
		endpoint = "https://api.bing.microsoft.com/v7.0/images/search?";
	}else if(type === 'videos'){
		secretKey = env.BING_VIDEOS_KEY;
		endpoint = "https://api.bing.microsoft.com/v7.0/videos/search?";
	}else if(type === 'news'){
		secretKey = env.BING_NEWS_KEY;
		endpoint = "https://api.bing.microsoft.com/v7.0/news/search?";
	}

	try{
		const options = { headers: { 'Ocp-Apim-Subscription-Key': secretKey} };
		const response = await fetch(endpoint + query, options);
		return await response.json();
	}catch{
		return null;
	}
}

async function searchAI(query){
	let secretKey = env.OPENAI_KEY;
	let endpoint = "https://api.openai.com/v1/completions";

	const data = {
		'model': 'text-ada-001',
		'prompt': query,
		'temperature': 0.5,
		'max_tokens': 50,
		'top_p': 1,
		'frequency_penalty': 0,
		'presence_penalty': 0
	};

	try{
		const options = { 'method': 'POST', 'headers': { 'Authorization': 'Bearer ' + secretKey, 'Content-Type': 'application/json'}, body: JSON.stringify(data)};
		const response = await fetch(endpoint, options);
		return await response.json();
	}catch{
		return null;
	}
}

router.use('*', cors({
    origin: ['https://rabbitsearch.org', 'https://rabbitsearch.net'],
    allowHeaders: ['*'],
    allowMethods: ['POST', 'GET', 'OPTIONS'],
    maxAge: 86400,
    credentials: true,
  })
);

router.get('/searchGeneral', async request => {
	env = request.env;
	let query = "q=";

	let knownBot = request.req.headers.get('x-known-bot') || 'false';
	let threatScore = request.req.headers.get('x-threat-score') || 0;
	if(knownBot === 'true' || threatScore > 10){
		return jsonResponse({ "error": 1050, "info": "Bots aren't allowed to use this API endpoint."});
	}

	const input = request.req.query('q');
	if(typeof(input) !== 'string' || input.length == 0) return jsonResponse({"error": 1100, "info": "Query is missing!"});
	query += encodeURIComponent(input.toLowerCase());

	const count = 50;
	query += "&count=" + count;

	let page = request.req.query('p');
	page = Number.parseInt(page);
	if(isNaN(page)) page = 1;
	if(page < 1 || page > 10) page = 1;
	query += "&offset=" + (count * (page - 1));

	let country = request.req.query('c');
	if(typeof(country) !== 'string' || country.length == 0){
		country = request.req.headers.get('cf-ipcountry');
	}
	query += "&cc=" + country + "&setLang=" + country;

	query += "&answerCount=1&promote=Webpages";

	let searchHash = await generateHash(query);
	let result = await getValue('search_' + searchHash);
	if(result !== null) return jsonResponse({"error": 0, "info": "success", "data": JSON.parse(result)});

	let data = await search(query);
	if(data == null) return jsonResponse({"error": 1105, "info": "Something went wrong while trying to fetch search results."});
	await setValue('search_' + searchHash, JSON.stringify(data), 864000, 864000);
	return jsonResponse({"error": 0, "info": "success", "data": data});
});

router.get('/searchImages', async request => {
	env = request.env;
	let query = "q=";

	let knownBot = request.req.headers.get('x-known-bot') || 'false';
	let threatScore = request.req.headers.get('x-threat-score') || 0;
	if(knownBot === 'true' || threatScore > 10){
		return jsonResponse({ "error": 1050, "info": "Bots aren't allowed to use this API endpoint."});
	}

	const input = request.req.query('q');
	if(typeof(input) !== 'string' || input.length == 0) return jsonResponse({"error": 1100, "info": "Query is missing!"});
	query += encodeURIComponent(input.toLowerCase());

	const count = 100;
	query += "&count=" + count;

	let page = request.req.query('p');
	page = Number.parseInt(page);
	if(isNaN(page)) page = 1;
	if(page < 1 || page > 10) page = 1;
	query += "&offset=" + (count * (page - 1));

	let country = request.req.query('c');
	if(typeof(country) !== 'string' || country.length == 0){
		country = request.req.headers.get('cf-ipcountry');
	}
	query += "&cc=" + country + "&setLang=" + country;

	let searchHash = await generateHash(query);
	let result = await getValue('searchImages_' + searchHash);
	if(result !== null) return jsonResponse({"error": 0, "info": "success", "data": JSON.parse(result)});

	let data = await search(query, 'images');
	if(data == null) return jsonResponse({"error": 1105, "info": "Something went wrong while trying to fetch search results."});
	await setValue('searchImages_' + searchHash, JSON.stringify(data), 864000, 864000);
	return jsonResponse({"error": 0, "info": "success", "data": data});
});

router.get('/searchVideos', async request => {
	env = request.env;
	let query = "q=";

	let knownBot = request.req.headers.get('x-known-bot') || 'false';
	let threatScore = request.req.headers.get('x-threat-score') || 0;
	if(knownBot === 'true' || threatScore > 10){
		return jsonResponse({ "error": 1050, "info": "Bots aren't allowed to use this API endpoint."});
	}

	const input = request.req.query('q');
	if(typeof(input) !== 'string' || input.length == 0) return jsonResponse({"error": 1100, "info": "Query is missing!"});
	query += encodeURIComponent(input.toLowerCase());

	const count = 100;
	query += "&count=" + count;

	let page = request.req.query('p');
	page = Number.parseInt(page);
	if(isNaN(page)) page = 1;
	if(page < 1 || page > 10) page = 1;
	query += "&offset=" + (count * (page - 1));

	let country = request.req.query('c');
	if(typeof(country) !== 'string' || country.length == 0){
		country = request.req.headers.get('cf-ipcountry');
	}
	query += "&cc=" + country + "&setLang=" + country;

	let searchHash = await generateHash(query);
	let result = await getValue('searchVideos_' + searchHash);
	if(result !== null) return jsonResponse({"error": 0, "info": "success", "data": JSON.parse(result)});

	let data = await search(query, 'videos');
	if(data == null) return jsonResponse({"error": 1105, "info": "Something went wrong while trying to fetch search results."});
	await setValue('searchVideos_' + searchHash, JSON.stringify(data), 864000, 864000);
	return jsonResponse({"error": 0, "info": "success", "data": data});
});

router.get('/searchNews', async request => {
	env = request.env;
	let query = "q=";

	let knownBot = request.req.headers.get('x-known-bot') || 'false';
	let threatScore = request.req.headers.get('x-threat-score') || 0;
	if(knownBot === 'true' || threatScore > 10){
		return jsonResponse({ "error": 1050, "info": "Bots aren't allowed to use this API endpoint."});
	}

	const input = request.req.query('q');
	if(typeof(input) !== 'string' || input.length == 0) return jsonResponse({"error": 1100, "info": "Query is missing!"});
	query += encodeURIComponent(input.toLowerCase());

	const count = 50;
	query += "&count=" + count;

	let page = request.req.query('p');
	page = Number.parseInt(page);
	if(isNaN(page)) page = 1;
	if(page < 1 || page > 10) page = 1;
	query += "&offset=" + (count * (page - 1));

	let country = request.req.query('c');
	if(typeof(country) !== 'string' || country.length == 0){
		country = request.req.headers.get('cf-ipcountry');
	}
	query += "&cc=" + country + "&setLang=" + country;

	let searchHash = await generateHash(query);
	let result = await getValue('searchNews_' + searchHash);
	if(result !== null) return jsonResponse({"error": 0, "info": "success", "data": JSON.parse(result)});

	let data = await search(query, 'news');
	if(data == null) return jsonResponse({"error": 1105, "info": "Something went wrong while trying to fetch search results."});
	await setValue('searchNews_' + searchHash, JSON.stringify(data), 259200, 259200);
	return jsonResponse({"error": 0, "info": "success", "data": data});
});

/*

Disabled OPENAI

router.get('/searchAI', async request => {
	env = request.env;

	let knownBot = request.req.headers.get('x-known-bot') || 'false';
	let threatScore = request.req.headers.get('x-threat-score') || 0;
	if(knownBot === 'true' || threatScore > 10){
		return jsonResponse({ "error": 1050, "info": "Bots aren't allowed to use this API endpoint."});
	}

	const input = request.req.query('q');
	if(typeof(input) !== 'string' || input.length == 0) return jsonResponse({"error": 1100, "info": "Query is missing!"});
	if(input.length >= 100) return jsonResponse({"error": 1100, "info": "Query is too long!"});

	let data = await searchAI(input);
	if(data == null) return jsonResponse({"error": 1105, "info": "Something went wrong while trying to fetch results."});
	return jsonResponse({"error": 0, "info": "success", "data": data});
});
*/

export default router;