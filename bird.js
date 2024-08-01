/// Region search

const toBaseString = (s) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

const getMatchingRegions = (query) => {
	const queries = toBaseString(query).split(/[\s,\-]+/).filter(s => s.trim().length > 0);

	if (queries.length === 0) {
		return { nearby: window.nearbyRegions, all: window.allRegions };
	}

	const nearbyMatchRegions = [];
	window.nearbyRegions.forEach((region) => {
		const name = toBaseString(region.name);
		const isInnerMatch = queries.every((query) => name.includes(query));
		if (isInnerMatch) {
			nearbyMatchRegions.push(region);
		}
	});

	const startMatchRegions = [];
	const innerMatchRegions = [];
	window.allRegions.forEach((region) => {
		const name = toBaseString(region.name);
		const isInnerMatch = queries.every((query) => name.includes(query));
		if (!isInnerMatch) {
			return;
		}
		const isStartMatch = name.startsWith(queries[0]);
		if (isStartMatch) {
			startMatchRegions.push(region);
		} else {
			innerMatchRegions.push(region);
		}
	});
	startMatchRegions.sort((a, b) => a.name.localeCompare(b.name));
	innerMatchRegions.sort((a, b) => a.name.localeCompare(b.name));
	let otherRegions = [...startMatchRegions, ...innerMatchRegions];

	// leave dupes if the list is long so you'd rather search for them in both places;
	// remove them if the list is short so you'll likely see them on the same screen
	if (otherRegions.length < 50) {
		const nearbyIds = nearbyMatchRegions.map(({ regionId }) => regionId);
		otherRegions = otherRegions.filter(({ regionId }) => !nearbyIds.includes(regionId));
	}
	return { nearby: nearbyMatchRegions, all: otherRegions };
};

const createRegionResult = (region) => {
	const { regionId, name } = region;
	const result = document.createElement('li');
	result.className = 'region-result';

	const resultButton = document.createElement('button');
	resultButton.type = 'button';
	const isSelected = regionId === window.selectedRegionId;
	resultButton.className = `region-result-button ${isSelected ? 'selected' : 'unselected'}`;
	resultButton.innerText = `${name}${isSelected ? ' ✔️' : ''}`;

	const onClick = () => {
		selectRegion(regionId, name);
		zoomToRegion(region);
	};
	resultButton.addEventListener('click', onClick);

	result.appendChild(resultButton);
	return result;
};

const createRegionResultList = (regions) => {
	const list = document.createElement('ul');
	list.className = 'region-results-list';
	regions.forEach((region) => {
		const result = createRegionResult(region);
		list.appendChild(result);
	});
	return list;
}

const showRegionResults = () => {
	const query = document.getElementById('region-search-input').value.toLowerCase();
	const { nearby, all } = getMatchingRegions(query);

	const output = document.getElementById('region-results');
	output.innerHTML = '';

	if (nearby.length > 0) {
		const nearbyTitle = document.createElement('h3');
		nearbyTitle.className = 'region-results-title';
		nearbyTitle.innerText = 'Nearby';
		output.appendChild(nearbyTitle);

		const nearbyList = createRegionResultList(nearby);
		output.appendChild(nearbyList);
	}
	if (nearby.length > 0 && all.length > 0) {
		const allTitle = document.createElement('h3');
		allTitle.innerText = 'All regions';
		allTitle.className = 'region-results-title';
		output.appendChild(allTitle)
	}
	if (all.length > 0) {
		const allList = createRegionResultList(all);
		output.appendChild(allList);
	}
};

/// Region detection

const toRadians = (deg) => Math.PI * deg / 180;
const toDegrees = (rad) => 180 * rad / Math.PI;

const EARTH_RADIUS = 6371009; // metres

// rough approximation of distance between two coords, in metres
const getApproxDistance = (a, b) => {
	latA = toRadians(a.latitude);
	longA = toRadians(a.longitude);
	latB = toRadians(b.latitude);
	longB = toRadians(b.longitude);
	latMid = (latA + latB) / 2;
	return EARTH_RADIUS * Math.sqrt(Math.pow(latA - latB, 2) + Math.pow(Math.cos(latMid) * (longA - longB), 2));
};

const getCentre = ({ minX, maxX, minY, maxY }) => ({
	latitude: (minY + maxY) / 2,
	longitude: (minX + maxX) / 2,
});

// diagonal size of region, in metres
const getRegionSize = ({ minX, maxX, minY, maxY }) => getApproxDistance(
	{ latitude: minX, longitude: minY },
	{ latitude: maxX, longitude: maxY },
);

const getNearbyRegions = ({ latitude, longitude, accuracy }) => {
	const radius = EARTH_RADIUS * Math.cos(toRadians(latitude));
	const latitudeError = toDegrees(accuracy / EARTH_RADIUS);
	const maxLatitude = latitude + latitudeError;
	const minLatitude = latitude - latitudeError;
	const longitudeError = toDegrees(accuracy / radius);
	const maxLongitude = longitude + longitudeError;
	const minLongitude = longitude - longitudeError;

	const nearbyRegions = window.allRegions
		.filter(({ minX, maxX, minY, maxY }) =>
			maxLongitude >= minX && minLongitude <= maxX && maxLatitude >= minY && minLatitude <= maxY
		)
		.map(region => ({
			...region,
			distance: getApproxDistance({ latitude, longitude }, getCentre(region)),
			size: getRegionSize(region),
		}))
		.map(region => ({
			...region,
			penalty: region.size * region.distance,
		}));
	nearbyRegions.sort((a, b) => a.penalty - b.penalty);
	console.log(nearbyRegions);
	return nearbyRegions;
};

const setRegionFromCoords = (coords) => {
	console.log(`Latitude: ${coords.latitude}\nLongitude: ${coords.longitude}\nAccuracy: ${coords.accuracy}\n`);
	window.nearbyRegions = getNearbyRegions(coords);
	const detectedRegion = window.nearbyRegions[0] || null;
	if (detectedRegion) {
		selectRegion(detectedRegion.regionId, detectedRegion.name);
	}
	return detectedRegion;
};

const locatePosition = () => {
	const output = document.getElementById('detect-message');
	output.textContent = 'Looking for your region…';

	window.nearbyRegions = [];
	window.selectedRegionId = null;
	window.birdsInRegion = [];
	document.getElementById('bird-gen-button').disabled = 'disabled';

	navigator.geolocation.getCurrentPosition(
		({ coords }) => {
			const detectedRegion = setRegionFromCoords(coords);
			if (detectedRegion) {
				zoomToRegion(detectedRegion);
				output.textContent = '';
			} else {
				output.textContent = `Couldn't detect your region.`;
			}
		},
		(err) => {
			output.textContent = `Couldn't detect your region.`;
			console.error(err);
		},
	);
};

/// Map

const zoomToRegion = ({ minX, maxX, minY, maxY }) => {
	if (!window.positionMap) {
		return;
	}
	window.positionMap.fitBounds([[minX, minY], [maxX, maxY]]);
};

const setPositionOnMap = ({ lngLat: { lat, lng } }) => {
	const coords = { latitude: lat, longitude: lng, accuracy: 10 };
	setRegionFromCoords(coords);
};

/// Load birds in chosen region

const selectRegion = (regionId, name) => {
	console.log(regionId, name);
	window.selectedRegionId = regionId;
	document.getElementById('region-search-input').value = name;
	window.birdsInRegion = [];
	document.getElementById('bird-gen-button').disabled = 'disabled';
	clearBird();
	fetch(`birds_by_region/${regionId}.json`)
		.then(res => res.json())
		.then((birds) => {
			window.birdsInRegion = birds;
			document.getElementById('bird-gen-button').disabled = false;
		});
	showRegionResults();
};

/// Show a random bird

const choice = (l) => l[Math.round(l.length * Math.random())];

const clearBird = () => {
	const display = document.getElementById('bird-display');
	display.style.display = 'none';

	const message = document.getElementById('bird-message');
	message.innerHTML = '';

	const iframe = document.getElementById('ebird-frame');
	iframe.src = 'https://ebird.org/';
};

const showBird = () => {
	clearBird();
	if (window.birdsInRegion.length === 0) {
		return;
	}
	const { birdId, commonName, sciName } = choice(window.birdsInRegion);

	const display = document.getElementById('bird-display');
	display.style.display = 'block';

	const message = document.getElementById('bird-message');
	message.innerHTML = `Your random bird is the <strong>${commonName}</strong> (<i>${sciName}</i>)!`;

	const iframe = document.getElementById('ebird-frame');
	iframe.src = `https://ebird.org/species/${birdId}/${window.selectedRegionId}`;

	message.scrollIntoView();
};

/// Setup on page load

const setupMap = () => {
	mapboxgl.accessToken = 'pk.eyJ1IjoibGVvdGFsIiwiYSI6ImNsejlyNWNiNzA2emsya3BsazV1eGs3Zm4ifQ.pnlJlI1xkXoIFntVCNmFrA';
	window.positionMap = new mapboxgl.Map({
		container: 'position-map', // container ID
		center: [0, 0], // starting position [lng, lat]. Note that lat must be set between -90 and 90
		zoom: 1, // starting zoom
	});
	window.positionMap.on('load', () => { window.positionMap.resize(); });
	window.positionMap.on('click', setPositionOnMap);
	window.addEventListener('resize', () => { window.positionMap.resize(); });
};

const init = () => {
	document.getElementById('detect-button').addEventListener('click', locatePosition);
	document.getElementById('region-search-input').addEventListener('input', showRegionResults);
	document.getElementById('bird-gen-button').addEventListener('click', showBird);

	window.allRegions = null;
	window.positionMap = null;
	window.nearbyRegions = [];
	window.selectedRegionId = null;
	window.birdsInRegion = [];
	fetch('regions.json')
		.then(res => res.json())
		.then(regions => {
			regions.sort((a, b) => a.name.localeCompare(b.name));
			window.allRegions = regions;
		})
		.then(() => {
			showRegionResults();
			locatePosition();
		});

	setupMap();
};

document.addEventListener('DOMContentLoaded', init);
