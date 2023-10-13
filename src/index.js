import { Hono } from 'hono';
import { cors } from 'hono/cors';
const router = new Hono();

let env;
const cache = caches.default;

const availableCountries = ['ar', 'au', 'at', 'be', 'br', 'ca', 'cl', 'dk', 'fi', 'fr', 'de', 'hk', 'in', 'id', 'it', 'jp', 'kr', 'my', 'mx', 'nl', 'nz', 'no', 'cn', 'pl', 'pt', 'ph', 'ru', 'sa', 'za', 'es', 'se', 'ch', 'tw', 'tr', 'gb', 'us'];

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
	let endpoint = "https://api.search.brave.com/res/v1/web/search?";
	let options = { headers: { 'X-Subscription-Token': env.BRAVE_SEARCH_KEY } };

	if(type === 'images'){
		endpoint = "https://api.search.brave.com/res/v1/images/search?";
	}else if(type === 'videos'){
		endpoint = "https://api.search.brave.com/res/v1/videos/search?";
	}else if(type === 'news'){
		endpoint = "https://api.search.brave.com/res/v1/news/search?";
	}

	try{
		const response = await fetch(endpoint + query, options);
		return await response.json();
	}catch{
		return null;
	}
}

async function fetchResultsFromBrave(request, type = 'search'){
	let query = "q=";

	let knownBot = request.req.headers.get('x-known-bot') || 'false';
	let threatScore = request.req.headers.get('x-threat-score') || 0;
	if(knownBot === 'true' || threatScore > 10){
		return jsonResponse({ "error": 1050, "info": "Bots aren't allowed to use this API endpoint."});
	}

	const input = request.req.query('q');
	if(typeof(input) !== 'string' || input.length == 0) return jsonResponse({"error": 1100, "info": "Query is missing!"});
	query += encodeURIComponent(input.toLowerCase());

	const count = 20;
	query += "&count=" + count;

	let page = request.req.query('p');
	page = Number.parseInt(page);
	if(isNaN(page)) page = 1;
	if(page < 1 || page > 10) page = 1;
	query += "&offset=" + (count * (page - 1));

	let country = request.req.query('m');
	if(typeof(country) !== 'string' || !availableCountries.includes(country)){
		country = 'us';
	}
	query += "&country=" + country;

	let safeSearch = request.req.query('s');
	if(typeof(safeSearch) !== 'string' || !['off', 'moderate', 'strict'].includes(safeSearch)){
		safeSearch = 'moderate';
	}
	if(type === 'images' && safeSearch === 'moderate') safeSearch = "strict";
	query += "&safesearch=" + safeSearch;

	if(type === 'search') query += "&result_filter=web";

	let searchHash = await generateHash(query);
	let result = await getValue(type + '_' + country + '_' + safeSearch + '_' + searchHash);
	if(result !== null) return jsonResponse({"error": 0, "info": "success", "data": JSON.parse(result)});

	let data = await search(query, type);
	if(data == null) return jsonResponse({"error": 1105, "info": "Something went wrong while trying to fetch search results."});
	await setValue(type + '_' + country + '_' + safeSearch + '_' + searchHash, JSON.stringify(data), 864000, 864000);
	return jsonResponse({"error": 0, "info": "success", "data": data});
}

router.use('*', cors({
    origin: ['https://rabbitsearch.org', 'https://rabbitsearch.net', 'https://dev.rabbitsearch.org', 'https://dev.rabbitsearch.net'],
    allowHeaders: ['*'],
    allowMethods: ['POST', 'GET', 'OPTIONS'],
    maxAge: 86400,
    credentials: true,
  })
);

router.get('/search', async request => {
	env = request.env;
	return await fetchResultsFromBrave(request, 'search');
});

router.get('/images', async request => {
	env = request.env;
	return await fetchResultsFromBrave(request, 'images');
});

router.get('/videos', async request => {
	env = request.env;
	return await fetchResultsFromBrave(request, 'videos');
});

router.get('/news', async request => {
	env = request.env;
	return await fetchResultsFromBrave(request, 'news');
});

export default router;