#!/usr/bin/env node

var blessed  = require('blessed'),
	contrib  = require('blessed-contrib'),
	screen   = blessed.screen({
		tput: true,
		smartCSR: true,
		autoPadding: true
	}),
	_ = require('lodash'),
	through = require('through2'),
	moment = require('moment');

var Docker = require('dockerode');
var stats = require('docker-stats')

var docker = new Docker();

var options = {
	docker: {socketPath: '/var/run/docker.sock'}
};

var containers = {};
var containerData = {};
var containerStats = {};
var dockerImages = {};
var logStream = null;
var lss = null;

docker.listContainers(function(err, cs){
	_.each(cs, function(v, i){
		var id = v.Id.toString().substring(0,12);
		containers[id] = v;
	});
});

docker.listImages(function(err, images){
	console.error(images);
});

function makeNow(){
	return moment().format('mm:ss')
}

function updateContainerStats(id, container){
	if (!containerStats[id]){
		containerStats[id] = {};
	}

	if (containerStats[id]['mem_max_usage'] && containerStats[id]['mem_max_usage'] != container.stats.memory_stats.max_usage){
		var memDelta = container.stats.memory_stats.max_usage - containerStats[id]['mem_max_usage'];
	}
	var mem_pct = parseFloat(parseFloat(container.stats.memory_stats.usage / container.stats.memory_stats.limit).toFixed(2));

	containerStats[id]['mem_max_usage'] = container.stats.memory_stats.max_usage;
	containerStats[id]['mem_usage'] = container.stats.memory_stats.usage;
	containerStats[id]['mem_pct'] = mem_pct;

	if (containerStats[id]['net_rx_total'] && containerStats[id]['net_rx_total'] != container.stats.network.rx_bytes){
		
	}

	var rxdiff = container.stats.network.rx_bytes - containerStats[id]['net_rx_total'];
	makeOrUpdateSeries(id, 'net_rx', 'RX bps', rxdiff, 'green');
	containerStats[id]['net_rx_total'] = container.stats.network.rx_bytes;

	if (containerStats[id]['net_tx_total'] && containerStats[id]['net_tx_total'] != container.stats.network.tx_bytes){
		
	}

	var txdiff = container.stats.network.tx_bytes - containerStats[id]['net_tx_total'];
	makeOrUpdateSeries(id, 'net_tx', 'TX bps', txdiff, 'cyan');
	containerStats[id]['net_tx_total'] = container.stats.network.tx_bytes;

	if (containerStats[id]['cpu_usage_total'] && containerStats[id]['cpu_usage_total'] != container.stats.cpu_stats.cpu_usage.total_usage){
		var cpuDelta = container.stats.cpu_stats.cpu_usage.total_usage - containerStats[id]['cpu_usage_total'];
	}

	containerStats[id]['cpu_usage_total'] = container.stats.cpu_stats.cpu_usage.total_usage;

	if (containerStats[id]['cpu_system_total'] && containerStats[id]['cpu_system_total'] != container.stats.cpu_stats.cpu_usage.total_usage){
		var systemDelta = container.stats.cpu_stats.cpu_usage.system_cpu_usage - containerStats[id]['cpu_system_total'];
	}

	containerStats[id]['cpu_usage_total'] = container.stats.cpu_stats.cpu_usage.total_usage;

	var cpuPercent = 0.0;

	if (systemDelta > 0.0 && cpuDelta > 0.0) {
		cpuPercent = (cpuDelta / systemDelta) * container.stats.cpu_stats.cpu_usage.percpu_usage.length * 100.0;
	}

	makeOrUpdateSeries(id, 'cpu', 'Percent', parseFloat(parseFloat(container.stats.cpu_stats.cpu_usage.cpu_percent).toFixed(2)), 'red');

	function makeSeries(name, y, color){
		return {title: name, y: [y], x: [makeNow()], style: {line: color || 'cyan'}};
	}

	function appendSeries(series, y){
		if (series.x.length > 30){
			series.x.shift();
			series.y.shift();
		}
		series.y.push(y);
		series.x.push(makeNow())
	}

	function makeOrUpdateSeries(id, type, name, y, color){
		if (!containerStats[id][type]){
			containerStats[id][type] = makeSeries(name, y, color);
		} else {
			appendSeries(containerStats[id][type], y)
		}
	}
}

stats(options).pipe(through.obj(function(container, enc, cb){
	if (!container || !container.id) return cb();

	var id = container.id;

	if (!containers[id]){
		return;
	}

	if (!containerData[id]){
		containerData[container.id] = container;
	}

	updateContainerStats(id, container);

	cb()
})).pipe(process.stdout);

var grid = new contrib.grid({rows: 12, cols: 12, screen: screen});

var networkLine = grid.set(4, 0, 6, 6, contrib.line, { style: 
	{ line: "yellow"
	, text: "green"
	, baseline: "black"}
	, xLabelPadding: 3
	, humanize: true
	, xPadding: 5
	, showLegend: true
	, wholeNumbersOnly: false
	, label: 'Network'});

var cpuLine = grid.set(4, 6, 6, 6, contrib.line, { style: 
	{ line: "yellow"
	, text: "green"
	, baseline: "black"}
	, xLabelPadding: 3
	, xPadding: 5
	, showLegend: true
	, wholeNumbersOnly: false
	, label: 'CPU'});

var memoryDonut = grid.set(0, 8, 4, 4, contrib.donut, {
	label: 'Memory',
	radius: 10,
	arcWidth: 3,
	spacing: 2,
	yPadding: 2,
	data: [
	{perent: 80, label: 'Used', color: 'green'}
	]
});

var containerLog = grid.set(10, 0, 2, 12, contrib.log, { 
	fg: "green"
	, selectedFg: "green"
	, label: 'Container Log'
});

var containerTable = grid.set(0, 0, 4, 6, contrib.table, { 
	keys: true
	, fg: 'white'
	, selectedFg: 'white'
	, selectedBg: 'blue'
	, interactive: true
	, label: 'Active Containers'
	, width: '30%'
	, height: '30%'
	, border: {type: "line", fg: "cyan"}
    , columnSpacing: 4 //in chars
    , columnWidth: [12, 32, 16] /*in chars*/
    , onSelect: containerTableSelect
    , onKey: containerTableKeyPress }
);

var containerActionTable = grid.set(0, 6, 4, 2, contrib.table, { 
	keys: true
	, fg: 'white'
	, selectedFg: 'white'
	, selectedBg: 'blue'
	, interactive: true
	, label: 'Actions'
	, width: '30%'
	, height: '30%'
	, border: {type: "line", fg: "cyan"}
    , columnSpacing: 4 //in chars
    , columnWidth: [32] /*in chars*/
    , onSelect: containerActionTableSelect }
);

var termScreen = null;

containerTable.focus();

function containerTableKeyPress(){
	// console.log(activeContainer);
	process.nextTick(function(){
		console.error(getSelectedContainer());
		updateSelectedContainer(getSelectedContainer());
	});
}

function updateSelectedContainer(container){
	activeContainer = container;
	updateContainerActions(activeContainer);
	renderStats();
}

function containerTableSelect(event, index){
	var ct = getTableData();
	var id = ct[index][0];
}

var containerActioner = {
	'open shell (/bin/bash)' : {
		handler: function(){
			var currentContainer = containers[activeContainer];
			if (currentContainer){
				var tsoptions = {
				  parent: screen,
				  cursor: 'line',
				  shell: '/usr/bin/docker',
				  args: ['exec', '-it', lastActive, '/bin/bash'],
				  cursorBlink: true,
				  screenKeys: false,
				  label: ' '+activeContainer+' ',
				  left: 0,
				  top: 0,
				  width: '50%',
				  height: '50%',
				  border: 'line',
				  style: {
				    fg: 'default',
				    bg: 'default',
				    // focus: {
				    //   border: {
				    //     fg: 'green'
				    //   }
				    // }
				  }
				};
				// focusable.push(termScreen);
				termScreen = grid.set(2, 2, 8, 8, blessed.terminal, tsoptions);
				termScreen.focus();
				termScreen.on('exit', function(){
					termScreen.destroy();
					screen.render();
					// focusable.pop();
				});
				screen.render();
			}
		}
	},
	'kill container...': {
		handler: function(){}
	},
	'stop container...': {
		handler: function(){}
	},
	'reset container...': {
		handler: function(){}
	}
}
var actionIndex = _.keys(containerActioner);
var actionMap = _.map(containerActioner, function(v, k){
	return [k];
});

function updateContainerActions(id){
	containerActionTable.setData({
		headers: ['action'],
		data: actionMap
	});
	// containerActionTable.focus();
}

var loader = null;

function containerActionTableSelect(event, index){
	var ct = getTableData();
	var id = ct[index][0];
	activeContainer = id;
	var action = actionIndex[index];
	containerActioner[action].handler();
	screen.render();
}

setTimeout(function(){
	updateContainerTable();
}, 1000);

function getTableData(){
	return _.map(containers, function(v, i){
		return [i, v.Names[0], v.Status];
	});
}
function getSelectedContainer(){
	return getTableData()[containerTable.getSelected()][0];
	activeContainer = i;
	return i;
}
function updateContainerTable(){
	if (_.size(containers) < 1) return;
	var tableData = getTableData();
	containerTable.setData({
		headers: ['id', 'name', 'uptime'],
		data: tableData
	});
	screen.render();
}

function stopLogStream(){
	if (!logStream || !lss) return;
	logStream.end();
	lss.end();
	logStream = null;
	lss = null;
}

function startLogStream(activeContainer){
	if (logStream) return;
	logStream = docker.getContainer(activeContainer).logs({stderr: 1, stdout: 1, follow: 1, tail: 10}, function(err, stream){
		if (err) return console.error("err: %s", err);
		lss = stream;
		stream.setEncoding('utf8');

		stream.on('data', function(entry){
			if (entry.trim().length == 8) return; //filter out some weird characters...
			
			containerLog.log(entry);
			
		});
		stream.on('error', function(){
			// console.error(arguments);
		});
		return;
	});
}

var activeContainer = null;
var lastActive = null;

function renderStats(){
	if (!activeContainer) return;
	var currentContainerStats = containerStats[activeContainer];
	var currentContainer = containers[activeContainer];

	if (lastActive != activeContainer){
		stopLogStream();
		containerLog.clear();
		startLogStream(activeContainer);
	}
	lastActive = activeContainer;

	if (currentContainerStats.net_tx && currentContainerStats.net_rx)
		networkLine.setData([currentContainerStats.net_rx, currentContainerStats.net_tx]);

	if (currentContainerStats.cpu)
		cpuLine.setData([currentContainerStats.cpu]);

	var memUsed = parseFloat(currentContainerStats.mem_usage / (1024 * 1024)).toFixed(2);
	var memColor = "green";

	if (currentContainerStats.mem_pct > 0.25) memColor = "cyan";
	if (currentContainerStats.mem_pct > 0.5) memColor = "yellow";
	if (currentContainerStats.mem_pct > 0.75) memColor = "red";
	memoryDonut.setData([{percent: currentContainerStats.mem_pct, label: memUsed + 'MB', color: memColor}])

	screen.render();
}

setInterval(function(){
	renderStats();
}, 1000);

var focusable = [
	containerTable,
	containerActionTable
];

var currentFocus = 0;

screen.key(['tab','S-tab'], function(ch, key){
	// focusable[currentFocus].style.border.fg = 'cyan';
	focusable[currentFocus].border.fg = 'cyan';
	// focusable[current].style.border.bg = 'cyan';
	if (key.shift){
		currentFocus--;
	} else {
		currentFocus++;
	}
	if (currentFocus > (focusable.length - 1) || currentFocus < 0){
		currentFocus = 0;
	}
	
	// focusable[currentFocus].style.border.fg = 'green';
	focusable[currentFocus].border.fg = 'green';
	
	focusable[currentFocus].focus();
	screen.render();
});

screen.key(['C-q'], function (ch, key) {
	return process.exit(0)
});
screen.key(['`'], function (ch, key) {
	// termScreen.focus();
});

screen.render();

/*

	var question = blessed.question({
		parent: screen,
		border: 'line',
		height: 'shrink',
		width: 'half',
		top: 'center',
		left: 'center',
		label: ' {blue-fg}Question{/blue-fg} ',
		tags: true,
		keys: true,
		vi: true
	}).ask('Are you sure?', function(err, res){
		if (res){
			loader = blessed.loading({
			  parent: screen,
			  border: 'line',
			  height: 'shrink',
			  width: 'half',
			  top: 'center',
			  left: 'center',
			  label: ' {blue-fg}Loader{/blue-fg} ',
			  tags: true,
			  keys: true,
			  hidden: true,
			  vi: true
			});
			loader.load('Stopping...');
			setTimeout(function(){
				loader.stop();
				grid.remove(termScreen);
				console.error(termScreen);
			}, 1000)
		}
	});*/