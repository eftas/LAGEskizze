var app = angular.module("fgis");
var intervalAlreadySet = false;
var map, drawnItems, drawControl, basemap, dashStyle, newColor;
var lines,
	linesArray = [];
var commentsMap = new Map();
var objectColor = "#f00";
var showTooltip = false;
var dialog = require('electron').remote.dialog; // Load the dialogs component of the OS
var fs = require('fs'); // Load the File System to execute our common tasks (CRUD)

app.directive('droppable', function() {
	return {
		scope: {
			drop: '&' // parent
		},
		link: function(scope, element) {
			// again we need the native object
			var el = element[0];
			el.addEventListener(
				'drop',
				function(e) {
					// Stops some browsers from redirecting.
					if(e.preventDefault) e.preventDefault();
					if(e.stopPropagation) e.stopPropagation();
					scope.drop({element:e});
					return false;
				},
				false
			);
		}
	}
});

app.controller("MapController", function($scope, $http, $sce){
	// The interval is set only once.
	if (!intervalAlreadySet) {
		intervalAlreadySet = true;
		// A data record should be stored at a fixed time interval. 1800000 ms is equivalent to 30 minutes.
		setInterval(function () {
		    $scope.saveEinsatz();
		}, 1800000);
	}

    // url of the local server
    $scope.localAddress = 'http://localhost:1337/';
    $scope.sideContent = {};
	$scope.sideContent.template = "";
	$scope.sideContent.textvar = "";
	$scope.sideContent.close = function(){
		$scope.sideContent.template = "";
	};
	$scope.sideContent.change = function(template){
		$scope.sideContent.template = template;
	};

    // Emitted every time the ngInclude content is reloaded.
    $scope.$on('$includeContentLoaded', function(event, target){
        // Only when the page is loaded the elements from the database can be displayed.
        if (target.includes('loadMenu')) {
            $scope.showLoadMenu();
        // Only when the page is loaded the color can be set
        } else if (target.includes('_drawnObject')) {
            $scope.setColorPicker();
        }
    });

	// This function is activated as soon as an element is moved by drag and drop.
	// The position in the map has to be adjusted again
	$scope.handleDrop = function(element) {
		var startId = element.dataTransfer.getData("text");
		var startElement = document.getElementById(startId);
		// we drop onto the fieldText or svg, so we need to access the parent field-div
		var targetElement = element.target.parentNode;
		// if we drop onto the svg polygon element, we need to go one level higher
		if (!$(targetElement).hasClass('fields'))
			targetElement = targetElement.parentNode;
		var targetId = targetElement.id;

		if (startId != targetId) {
			//save the texts:
			var _imageTarget      = $('#image' + targetId).attr('src');
			var _textTopTarget    = $('#fieldTextTop' + targetId).html();
			var _textBottomTarget = $('#fieldTextBottom' + targetId).html();
			var _commentTarget    = $('#fieldComment' + targetId).html();
			var _imageStart       = $('#image' + startId).attr('src');
			var _textTopStart     = $('#fieldTextTop' + startId).html();
			var _textBottomStart  = $('#fieldTextBottom' + startId).html();
			var _commentStart     = $('#fieldComment' + startId).html();

			//swap the images and texts
			startElement.innerHTML = getFieldHtmlString(
				startId, _imageTarget, _commentTarget,
				_textTopTarget, _textBottomTarget
			);

			targetElement.innerHTML = getFieldHtmlString(
				targetId, _imageStart, _commentStart,
				_textTopStart, _textBottomStart
			);
			var elements = [];
			//  An element is moved from a to b. The position in the map must be retained.
			//  The new position and the original location in the map are saved
			if (linesArray[startId]) {
				// Only in this case, the position on the map is also stored in the object.
				// By drag & drop, the element is first removed and then re-marked. When deleting, the position in the map is lost, this must be saved. So the position on the map is stored in the object.
				elements.push({
					'mappos': linesArray[startId][3],
					'fieldid': parseInt(targetId)
				});
			}
			// An element already exists at the position b, then this is moved from b to a. Both elements exchange their places
			if (linesArray[targetId]) {
				elements.push({
					'mappos': linesArray[targetId][3],
					'fieldid': parseInt(startId)
				});
			}

			// If an element is moved, the old position is first deleted and then redrawn
			$scope.fields.deleteLocationOnMap(parseInt(startId));
			$scope.fields.deleteLocationOnMap(parseInt(targetId));
			// The elements are re-drawn
			$scope.fields.addLine(elements);
		}
	};

	/********************************
	********  loading/saving ********
	********************************/
	// Current version and one or two window variant. This is important for importing external records.
	$scope.version = '';
	$scope.screen = '';
	// object that will contain the current state on save
	$scope.einsatz = {
		id: 0,
		metadata: { // filled via ng-model
			acronym: '',
			keyword: '',
			location: '',
			notify: '',
			number: '',
			date: ''
		},
		// rest will be filled on save()
		drawnObjects: [],
		taktZeichen: [],
		map: {
			zoom: 0,
			center: {},
			tileServer: '' // basemap layer
		},
		version: '',
		screen: ''
	};
	/*
	 * The version number and the program type are read from the metadata.json.
	 */
	$http.get('metadata/metadata.json')
		.then(function successCallback(response) {
			$scope.version = response.data.version;
			$scope.screen = response.data.screen;
		}, function errorCallback () {
			alert('Die Datei metadata.json wurde nicht gefunden.');
		});

	/*
	 * Entries from a file are imported into the database
	 */
	$scope.importEntry = function () {
		dialog.showOpenDialog({
			title: 'Import Dataset',
			// The filters specifies an array of file types that can be displayed or selected
			filters: [
				{name: 'JSON', extensions: ['json']}
			]
		}, function(fileName) {
			if (fileName.length > 0) {
				// The selected file is read
				fs.readFile(fileName[0], 'utf-8', function(err, data) {
					if (err == null) {
						if (data.trim() != '') {
							var parsedData = JSON.parse(data);
							// A file can only be imported if the type of the program is identical. Mono or multiple screen.
							if (!($scope.screen == 'Ein-Fenster' && parsedData.fireDoc[0].screen == 'Zwei-Fenster')) {
								// The entry is added to the database
								// The JSON.parse() method parses a JSON string, constructing the JavaScript value or object described by the string.
								$http.post($scope.localAddress + 'api/addEntry/', JSON.parse(data))
									.then(function successCallback(response) {
										if (response.data.result) {
											// The table is updated
											$scope.showLoadMenu();
											// If the versioning is different, then a warning is issued.
											if (parsedData.fireDoc[0].version != $scope.version) {
												alert('Warnung: Version des importierten Einsatzes: ' + parsedData.fireDoc[0].version + '. Version der LAGEskizze: ' + $scope.version + '. Hierbei können Probleme auftreten.');
											}
										}
									});
							} else {
								alert('Fehler: Der Einsatz kann nur mit der ' + parsedData.fireDoc[0].screen + ' Variante importiert werden.');
							}
						}
					}
				});
			}
		});
	};

	/*
	 * The last entry is exported to a .json file.
	 */
	$scope.exportEntry = function () {
		// Get all database entries
		$http.get($scope.localAddress + 'api/getAllEntries/')
			.then(function successCallback(response) {
				var dbData = response.data;
				// If entries are present, a file-dialog opens
				if (dbData.length > 0) {
					// Get the last entry
					// The JSON.stringify() method converts a JavaScript value to a JSON string
					var lastEntry = JSON.stringify(dbData[dbData.length - 1]);
					// Opens the save-file-dialog
					dialog.showSaveDialog({
						title: 'Export Dataset',
						// The filters specifies an array of file types that can be displayed or selected
						filters: [
							{name: 'JSON', extensions: ['json']}
						]
					}, function (fileName) {
						// If a path is selected, the entry is written to the file
						if (typeof (fileName) != 'undefined') {
							fs.writeFile(fileName, lastEntry, function(err) {});
						}
					});
				}
			});
	};

    /**
     * A new mission is created. The existing lines are removed.
     */
    $scope.newMission = function () {
    	lines.clearLayers();
        linesArray = [];
        window.location.hash = '/';
    };

	/**
	 * The current dataset is removed from the database.
     */
	$scope.deleteEntry = function () {
		if ($scope.einsatz.id) {
			$http['delete']($scope.localAddress + 'api/deleteEntry/' + $scope.einsatz.id)
				.then(function successCallback(response) {
					if (response.data.result) {
                        lines.clearLayers();
                        linesArray = [];
						// Initial state
						window.location.hash = '#/map/';
					}
				});
		}
	};

	/**
	* serializes the current state into $scope.einsatz & pushs it to the DB server
	*/
	$scope.saveEinsatz = function() {
		// Mandatory fields
		if (!$scope.einsatz.metadata.keyword || !$scope.einsatz.metadata['location'] || !$scope.einsatz.metadata['notify'] || !$scope.einsatz.metadata.number || !$scope.einsatz.metadata.date || !$scope.einsatz.metadata.acronym) {
			return alert('Die Felder Einsatzstichwort, Einsatzort, Meldender, Benutzerkürzel, Objektnr und Uhrzeitgruppe sind erforderlich.');
		}
		// An entry can only be saved if a symbol is set or a line has been drawn into the map.
		var startSaveing = false;
		if (linesArray.length > 0) {
			for(i = 0; i < linesArray.length; i++) {
				if (linesArray[i]) {
					startSaveing = true;
					break;
				}
			}
		}
		if (startSaveing) {
			// Set version number and screen mode
			$scope.einsatz.version = $scope.version;
			$scope.einsatz.screen = $scope.screen;
			// Current timestamp in ms
			$scope.einsatz.id = new Date().getTime();
			// copy field data into $scope.einsatz.fields
			$scope.einsatz.taktZeichen = [];
			for (var i = 0; i < $scope.fields.fieldOrder.properties.length; i++) {
				var kranzPos = $scope.fields.fieldOrder.properties[i].id;
				var line = linesArray[kranzPos];

				if (line || $('#image' + kranzPos).attr('src')) {
					$scope.einsatz.taktZeichen.push({
						kranzposition: kranzPos,
						kartenposition: line ? [line[0],line[2],line[3]] : '',
						zeichen:    $('#image' + kranzPos).attr('src') || '',
						comment:    $('#fieldComment' + kranzPos).text() || '',
						textTop:    $('#fieldTextTop' + kranzPos).text() || '',
						textBottom: $('#fieldTextBottom' + kranzPos).text() || ''
					});
				}
			}

			// push drawn object data into $scope.einsatz.drawnObjects
			$scope.einsatz.drawnObjects = [];
			drawnItems.eachLayer(function(layer) {
				var geojson = layer.toGeoJSON();
				geojson.properties.comment = commentsMap.get(drawnItems.getLayerId(layer)) || '';
				geojson.properties.color = layer.options.color || '';
				geojson.properties.showTooltip = layer.options.showTooltip;
				geojson.properties.dashArray = layer.options.dashArray;
				// as leaflet draw serializes a circle as a point, we need to store the radius manually.
				if (layer._mRadius) geojson.properties.circleRadius = layer._mRadius;
				$scope.einsatz.drawnObjects.push(geojson);
			});
			// save map state
			$scope.einsatz.map.zoom = map.getZoom();
			$scope.einsatz.map.center = map.getCenter();
            $scope.einsatz.map.tileServer = $scope.map.tileServer;

            /**
			 * A new entry is added to the database.
			 */
			function postEntry() {
				$http.post($scope.localAddress + 'api/addEntry/', $scope.einsatz)
					.then(function successCallback(response) {
						if (response.data.result) {
							// The table is updated
							$scope.showLoadMenu();
							window.location.hash = '#/map/' + $scope.einsatz.id;
						}
					});
			}
			if ($scope.einsatz.id) {
				postEntry();
			}
		}
	};
    /**
     * If "Save / Load" is activated, a new HTML document will be loaded.
     */
	$scope.addLoadMenuHtml = function () {
        $scope.fields.cancel();
        $scope.sideContent.change("app/templates/fgis/loadMenu.html");
        try{$scope.map.editCancel();}catch(e){}
    };
	/**
	* fills the table of available einsätzes from DB
 	*/
	$scope.showLoadMenu = function(){
		$http.get($scope.localAddress + 'api/getAllEntries/')
			.then(function successCallback(response) {
			    var table = $('#einsatzTable');
				table.empty();
				for (var i = 0; i < response.data.length; i++) {
					var einsatz = response.data[i];
					var tableRow = $('<tr onclick="window.location.hash=\'/#/map/' + einsatz.id + '\'"><td>'
						+ einsatz.metadata.keyword + '</td><td>'
						+ einsatz.metadata.location + '</td><td>'
						+ einsatz.metadata.acronym + '</td><td>'
						+ einsatz.map.tileServer + '</td><td>'
						+ einsatz.metadata.number + '</td><td>'
						+ einsatz.metadata.date + '</td></tr>');
					$('#einsatzTable').append(tableRow);
				}
                table.trigger("update");
			});
	};

    /**
     * Show the current color of the selected object in the colorPicker
     * Function is called when the document is already loaded
     */
	$scope.setColorPicker = function() {
        objectColor = drawnItems.getLayer($scope.map.objectId).options.color;
        dashStyle = drawnItems.getLayer($scope.map.objectId).options.dashArray;
		showTooltip = drawnItems.getLayer($scope.map.objectId).options.showTooltip;
        $("#colorPicker").spectrum({
            color: objectColor,
			chooseText: 'OK',
			cancelText: 'Schließen',
            change: function(color) {
                newColor = color.toHexString();
            }
        });
        // Checkbox will be checked if the dashStyle is set
        if (dashStyle === null) $('#dashed').prop('checked', false);
        else $('#dashed').prop('checked', true);
		if (showTooltip) $('#labelGeometry').prop('checked', true);
		else $('#labelGeometry').prop('checked', false);
    };

	/**
	 * loads a einsatz identified by its ID
	 */
	$scope.loadEinsatz = function(id) {
	    if (!isNaN(parseInt(id))) {
            $http.get($scope.localAddress + 'api/getEntry/' + id)
                .then(function successCallback(response) {
                    if (response.data.result) updateState(response.data.metadata);
                });
        }

		function updateState(einsatz) {
            // ein datensatz für einen lageplan kann nur geöffnet werden, wenn zuvor ein lageplan der karte hinzugefügt wurde
            // ein datensatz der auf grundlage eines WMS entstanden ist kann nur geöffnet werden, wenn ein WMS ausgewählt wurde
            if (einsatz.map.tileServer.trim() === 'Lageplan' && $scope.map.tileServer.trim() !== 'Lageplan') {
                alert('Fehler: Für diesen Datensatz wird ein Lageplan (Kartenmaterial) benötigt.');
            } else if (einsatz.map.tileServer.trim() !== 'Lageplan' && $scope.map.tileServer.trim() === 'Lageplan') {
                alert('Fehler: Für diesen Datensatz wird kein Lageplan benögtigt. Bitte wählen Sie eine andere Hintergrundkarte aus.');
            } else {
                // A file can only be imported if the type of the program is identical. Mono or multiple screen.
                if (!($scope.screen == 'Ein-Fenster' && einsatz.screen == 'Zwei-Fenster')) {
                    // store new einsatz data in $scope.einsatz reset from previous state
                    $scope.einsatz = einsatz;
                    lines.clearLayers();
                    linesArray = [];
                    drawnItems.clearLayers();

                    // insert drawnObjects
                    for (var i = 0; i < $scope.einsatz.drawnObjects.length; i++) {
                        // convert geojson -> FeatureGroup -> ILayer
                        var geojson = $scope.einsatz.drawnObjects[i];
                        var featureGroup = L.geoJson(geojson, {
                            pointToLayer: function (json, latlng) {
                                if (json.properties.circleRadius) {
                                    return new L.circle(latlng, json.properties.circleRadius, {
                                        fillColor: json.properties.color,
                                        color: json.properties.color,
                                        weight: 5
                                    });
                                } else {
                                    return new L.marker(latlng);
                                }
                            }
                        });
                        var layer = featureGroup.getLayers()[0]; // extract the first (and only) layer from the fGroup
                        layer.options.style = {color: geojson.properties.color};
                        layer.options.color = geojson.properties.color;
                        layer.options.showTooltip = geojson.properties.showTooltip;
                        layer.options.dashArray = geojson.properties.dashArray;
                        // If the tooltip is set and a comment is present, then the feature is labeled
                        if (geojson.properties.showTooltip && geojson.properties.comment.trim() != '') {
                            layer.bindTooltip(geojson.properties.comment, {
                                permanent: true,
                                className: 'customTooltip'
                            }).openTooltip();
                        }

                        if (geojson.properties.circleRadius) layer.feature.geometry.type = 'circle';

                        drawnItems.addLayer(layer);

                        // register comment
                        var layerID = drawnItems.getLayerId(layer);
                        commentsMap.set(layerID, geojson.properties.comment);

                        // register click events
                        layer.on('click', function (e) {
                            $scope.map.objectClicked(e.target.feature.geometry.type, e.target, e.target._leaflet_id);
                        });
                    }

                    // make layers unclickable by default
                    drawnItems.eachLayer(function (layer) {
                        setClickable(layer, false);
                    });

                    // upate mapstate
                    map.setView($scope.einsatz.map.center, $scope.einsatz.map.zoom);
                    // setze taktische zeichen in karte
                    for (var i = 0; i < $scope.einsatz.taktZeichen.length; i++) {
                        var field = $scope.einsatz.taktZeichen[i];
                        var fieldHtml = getFieldHtmlString(field.kranzposition, field.zeichen,
                            field.comment, field.textTop, field.textBottom);
                        $('#' + field.kranzposition).html(fieldHtml);

                        // field line / kartenposition
                        if (field.kartenposition == '') {
                            continue; // field has no kartenposition
                        }
                        var anchorPoint = getAnchorOfElement('image' + field.kranzposition);
                        linesArray[field.kranzposition] = [field.kartenposition[0], anchorPoint, field.kartenposition[1], field.kartenposition[2]];
                        fitAllLines(linesArray);
                    }
                    // If the versioning is different, then a warning is issued.
                    if (einsatz.version != $scope.version) {
                        alert('Warnung: Version des importierten Einsatzes: ' + einsatz.version + '. Version der LAGEskizze: ' + $scope.version + '. Hierbei können Probleme auftreten.');
                    }
                } else {
                    alert('Fehler: Der Einsatz kann nur mit der ' + einsatz.screen + ' Variante importiert werden.');
                }
            }
		}
	};

	/********************************
	************ Fields *************
	********************************/

	$scope.fields = {};
	$scope.fields.fieldOrder = fieldOrder;
	$scope.fields.symbols = symbolProperties;
	$scope.fields.symbolsFilter = "";
	$scope.fields.currentField = {};
	$scope.fields.currentField.image = "images/symbols/_universal.svg";
	$scope.fields.currentField.topText = "";
	$scope.fields.currentField.bottomText = "";
	$scope.fields.currentField.commentField = "";
	$scope.fields.currentField.active = false;
	$scope.fields.currentField.id = undefined;
	$scope.fields.currentField.fieldTextTop = "";
	$scope.fields.currentField.fieldTextBottom = "";
	$scope.fields.currentField.fieldComment = "";


	/**
	* @desc activates a tz slot, shows the field-properties in the side-content
	*/
	$scope.fields.register = function(field){
		$('#' + $scope.fields.currentField.id).removeClass("activated");
		$scope.fields.deleteLastLine($scope.fields.currentField.id);

		// when the clicked field is already the active/current one: deselect it
		if ($scope.fields.currentField.id == field) {
			$scope.fields.cancel();
			return;
		}

		var _template = "app/templates/fgis/_fieldContent.html";
		try{$scope.map.editCancel();}catch(e){}
		var thisImage = document.getElementById(field).getElementsByTagName('img');
		$scope.fields.currentField.id = field;
		$scope.fields.currentField.active = true;
		$('#' + $scope.fields.currentField.id).addClass("activated"); //highlight

		drawnItems.eachLayer(function(layer) {
			setClickable(layer, false);
		});

		if(thisImage.length == 0){
			$scope.fields.currentField.image = "images/symbols/_universal.svg";
			$scope.fields.currentField.topText = "";
			$scope.fields.currentField.bottomText = "";
			$scope.fields.currentField.commentField = "";
			$scope.fields.currentField.fieldTextTop = "";
			$scope.fields.currentField.fieldTextBottom = "";
			$scope.fields.currentField.fieldComment = "";
		}
		else {
			$scope.fields.currentField.image = thisImage[0].src;
			$scope.fields.currentField.topText = "";
			$scope.fields.currentField.bottomText = "";
			$scope.fields.currentField.commentField = "";
			$scope.fields.currentField.fieldTextTop = document.getElementById('fieldTextTop'+field).innerHTML;
			$scope.fields.currentField.fieldTextBottom = document.getElementById('fieldTextBottom'+field).innerHTML;
			$scope.fields.currentField.fieldComment = document.getElementById('fieldComment'+field).innerHTML;
		}
		$scope.sideContent.change(_template);
	};

	//submit the field ('bestaetigen')
	$scope.fields.submit = function(){
		$scope.fields.currentField.active = false;
		$scope.map.lastClick = null;
		if(linesArray[$scope.fields.currentField.id] != null){
			$('#' + $scope.fields.currentField.id).removeClass("activated");
		}

		var fieldHtml = getFieldHtmlString(
			$scope.fields.currentField.id,
			$scope.fields.currentField.image,
			$scope.fields.currentField.fieldComment,
			$scope.fields.currentField.fieldTextTop,
			$scope.fields.currentField.fieldTextBottom
		);

		document.getElementById($scope.fields.currentField.id).innerHTML = fieldHtml;
		$scope.sideContent.close();
	};

	$scope.fields.cancel = function(){
		$scope.sideContent.close();
		$scope.fields.currentField.active = false;
        $scope.map.lastClick = null;
		$('#' + $scope.fields.currentField.id).removeClass("activated");
		$scope.fields.deleteLastLine($scope.fields.currentField.id);
        $scope.fields.currentField.id = undefined;
	};

	$scope.fields['delete'] = function(){
		if ($scope.fields.currentField.id) {
			var fieldHtml = getFieldHtmlString($scope.fields.currentField.id, '', '', '', '');
			document.getElementById($scope.fields.currentField.id).innerHTML = fieldHtml;

			$scope.sideContent.close();
			$scope.fields.currentField.active = false;
			$('#' + $scope.fields.currentField.id).removeClass("activated");
			$scope.fields.currentField.id = null;
		}
	};

	//filter the list of fields
	$scope.fields.fiterSymbols = function(string){
		$scope.fields.symbolsFilter = string;
	};

	/**
	* @desc changes symbol of currentField in tz
	* @param string: string for new symbol location
	* Please note that this function is not used and should be deleted 
	* if not used in further development
	**/
	$scope.fields.addSymbol = function(string){
		$scope.fields.currentField.image = "images/symbols/" + string + ".svg";
		document.getElementById('image'+ $scope.fields.currentField.id).src = $scope.fields.currentField.image;
	};

	/********** Lines ********/

	// The location of an element is deleted, in this case the assignments of other elements may need to be removed/changed.
	$scope.fields.deleteLocationOnMap = function(fieldid) {
		var currentFieldId = fieldid;
		// It is checked whether a dataset is available.
		if (linesArray[currentFieldId]) {
			// Left and right neighbor
			var leftItem = linesArray[currentFieldId - 1];
			var rightItem = linesArray[currentFieldId + 1];
			var elements = [];
			// Test whether a left neighbor exists
			if (leftItem) {
				// Left neighbour is my son or my brother
				if (leftItem[2] == currentFieldId || (leftItem[2] == linesArray[currentFieldId][2] && linesArray[currentFieldId][2] != null)) {
					elements.push({'fieldid': currentFieldId - 1});
				}
			}
			// Test whether a right neighbor exists
			if (rightItem) {
				// Right neighbour is my son or my brother
				if (rightItem[2] == currentFieldId || (rightItem[2] == linesArray[currentFieldId][2] && linesArray[currentFieldId][2] != null)) {
					elements.push({'fieldid': currentFieldId + 1});
				}
			}
			// The currently selected element will be reset
			linesArray[currentFieldId] = null;
			fitAllLines(linesArray);
			$scope.fields.addLine(elements);
		}
	};

	$scope.fields.updateLine = function(){
		if ($scope.fields.currentField.id) $scope.fields.addLine([{'fieldid': $scope.fields.currentField.id}]);
	};

	$scope.fields.addLine = function(elements){
		// aufbau des linesArray[]
		// [Position in der Karte, Position am Bildschirmrand, Nummer des Vaters, Originale Kartenposition vom element]
		if (elements.length > 0) {
			// Wenn das Attribut mappos existiert, dann wurde das element per drag & drop verschoben. in diesem fall wird ein klick in die karte simuliert.
			if (elements[0].mappos) $scope.map.lastClick = elements[0].mappos;
			var currentFieldId = elements[0].fieldid;
			var neighbourLeft = linesArray[currentFieldId - 1];
			var neighbourRight = linesArray[currentFieldId + 1];
			// Existiert bereits ein eintrag oder ist das feld leer und es wird zum erstenmal ein eintrag erstellt.
			if (linesArray[currentFieldId]) {
				// Das ausgewählte element ist ein sohn und ist einem element zugewiesen. in diesem fall müssen die nachbarn überprüft werden, ob diese ebenfalls söhne vom gleichen vater sind.
				if (linesArray[currentFieldId][2]) {
					// Es müssen nur Elemente betrachtet werden die den gleichen Vater haben
					if (neighbourLeft) {
						// der linke nachbar ist ebenfalls der sohn vom selben vater
						if (neighbourLeft[2] == linesArray[currentFieldId][2]) {
							elements.push({
								"fieldid": currentFieldId - 1
							})
						}
					}
					if (neighbourRight) {
						// der rechte nachbar ist ebenfalls der sohn vom selben vater
						if (neighbourRight[2] == linesArray[currentFieldId][2]) {
							elements.push({
								"fieldid": currentFieldId + 1
							})
						}
					}
				}
			}
			// Bildschirmkoordinate
			var anchorPoint = map.containerPointToLatLng(getAnchorOfElement(currentFieldId));
			var lineToMapPos = null;
			// eine linie wird erstellt. diese linie verbindet das element und die position in der karte
			// else-fall: wurde keine position in der karte ausgwählt, dann besitzt jedes element seine ursprünglliche positin in der karte.
			if ($scope.map.lastClick) lineToMapPos = L.latLng($scope.map.lastClick.lat, $scope.map.lastClick.lng);
			else lineToMapPos = L.latLng(linesArray[currentFieldId][3].lat, linesArray[currentFieldId][3].lng);
			// es wird überprüft ob eine summenklammer erstellt werden kann. die position des elementes mit dem die verbindung erstellt werden soll wird zurückgeliefert
			var neighbourPos = $scope.checkCreateSummarize([currentFieldId - 1, currentFieldId + 1], currentFieldId, lineToMapPos);
			// wenn es kein passendes element gibt, dann einfach eine linie vom element bis zur karte gezeichnet
			if (!neighbourPos) {
				if ($scope.map.lastClick) linesArray[currentFieldId] = [$scope.map.lastClick, anchorPoint, null, $scope.map.lastClick];
				// wurde keine position in der karte ausgwählt, dann besitzt jedes element seine ursprünglliche positin in der karte.
				else linesArray[currentFieldId] = [linesArray[currentFieldId][3], anchorPoint, null, linesArray[currentFieldId][3]];
				// Eine Summenklammer mit dem gefundenen Element wird erstellt.
			} else linesArray[currentFieldId] = [linesArray[neighbourPos][1], anchorPoint, neighbourPos, linesArray[neighbourPos][3]];

			fitAllLines(linesArray);
			$scope.fields.currentField.active = true;
			$scope.map.lastClick = null;
			elements.shift();
			if (elements.length > 0) $scope.fields.addLine(elements);
		}
	};

	// Eine Summenklammer darf nur mit dem direkten nachbarn erstellt werden.
	// In der variablen fieldIdsArray sind die positionen der beiden nachbarn gespeichert
	$scope.checkCreateSummarize = function(fieldIdsArray, currentFieldId, lineToMapPos) {
		var casketSameRegion = false;
		var fieldId = null;
		var shortestDist = null;
		var tmpDist = null;
		var neighbourPos = null;
		for(var i = 0; i < fieldIdsArray.length; i++) {
			casketSameRegion = false;
			fieldId = fieldIdsArray[i];
			// top / left / right / bottom
			// Nur Elemente auf der gleiche Ebene dürfen miteinader verbunden werden
			if (fieldId >= 1 && fieldId <= 8 && currentFieldId >= 1 && currentFieldId <= 8) casketSameRegion = true;
			else if (fieldId >= 9 && fieldId <= 14 && currentFieldId >= 9 && currentFieldId <= 14) casketSameRegion = true;
			else if (fieldId >= 15 && fieldId <= 22 && currentFieldId >= 15 && currentFieldId <= 22) casketSameRegion = true;
			else if (fieldId >= 23 && fieldId <= 28 && currentFieldId >= 23 && currentFieldId <= 28) casketSameRegion = true;
			if (casketSameRegion && linesArray[fieldId]) {
				// jedes element besitzt seine ursprüngliche position in der karte. anhand dieser position wird eine distanz berechnet. zwischen dem bestehenden element und dem neuen element.
				if (linesArray[fieldId][3]) tmpDist = lineToMapPos.distanceTo(L.latLng(linesArray[fieldId][3].lat, linesArray[fieldId][3].lng));
				// ist die distanz kleiner als 50 meter dann kann eine summenklammer erstellt werden
				if (tmpDist <= 50 && (shortestDist == null || tmpDist < shortestDist)) {
					// wenn das element einen vater hat, dann wird dessen id benötigt
					if (linesArray[fieldId][2]) neighbourPos = linesArray[fieldId][2];
					else neighbourPos = fieldId;
					shortestDist = tmpDist;
				}
			}
		}
		return neighbourPos;
	};

	$scope.fields.deleteLastLine = function(oldId){
		if (oldId) {
			var _oldField = document.getElementById(oldId).innerHTML;
			var _oldSplitted = _oldField.split("polygon");
			if (_oldSplitted.length > 1){
				linesArray[oldId] = null;
				fitAllLines(linesArray);
			}
		}
	};

	/********************************
	************** Map **************
	********************************/

	initMap();
	var itemDrawed = false; //ignore setting last click for tz line if last click was for drawing
	map.on('click', function(e){
		if(!itemDrawed){
			$scope.map.lastClick = e.latlng;
			$scope.fields.updateLine();
		}
		else{
			$scope.map.lastClick = null;
			itemDrawed = false;
		}
	});
	map.on('move', function(){
		fitAllLines(linesArray);
	});
	map.on('draw:drawstop', function(){});

	map.on('draw:drawstart', function(){});

	map.on('draw:created', function (e) {
		var type = e.layerType,
			layer = e.layer;
		var id = drawnItems.getLayerId(layer);
		layer.on('click', function(e){$scope.map.objectClicked(type, layer, id)});
		$scope.map.lastClick = null;
		itemDrawed = true;
		drawnItems.addLayer(layer);
	});

	$scope.map = {};
	$scope.map.frozen = false;
	$scope.map.lastClick = null;
	$scope.map.objectId = null;
	$scope.hideColorPicker = false;
	$scope.geomType = '';

	$scope.map.objectClicked = function(type, layer, id){
		if (!$scope.map.editActive){
			drawnItems.eachLayer(function(layer) {
				setClickable(layer, false);
			});

			// hide colorPicker if the selected object is a marker
			if(type == "marker" || type.toLowerCase() == "point") {
				$scope.hideColorPicker = true;
				$scope.geomType = 'point';
			} else {
				$scope.hideColorPicker = false;
				$scope.geomType = type;
			}

			$scope.map.objects.getMeasurement(type, layer);
			$scope.map.objectId = id;
			$scope.map.showComment();
			$scope.$apply(function() {});
		}
	};

	$scope.map.zoomIn = function(){
		if (!$scope.map.frozen) {map.zoomIn();}
	};
	$scope.map.zoomOut = function(){
		if (!$scope.map.frozen) {map.zoomOut();}
	};
	$scope.map.freeze = function(){
		if($scope.map.frozen){
			$scope.map.frozen = false;
			map.dragging.enable();
			map.scrollWheelZoom.enable();
			map.touchZoom.enable();
			map.doubleClickZoom.enable();
			map.boxZoom.enable();
			map.keyboard.enable();
			$("#map").css('cursor', '');
			$("#freezeMapLock").css('display', 'none');
			$("#freezeMap").css('color', 'black');
			$(".customZoomControl").css('color', 'black');
		}
		else {
			$scope.map.frozen = true;
			map.dragging.disable();
			map.scrollWheelZoom.disable();
			map.touchZoom.disable();
			map.doubleClickZoom.disable();
			map.boxZoom.disable();
			map.keyboard.disable();
			$("#map").css('cursor', 'default');
			$("#freezeMapLock").css('display', 'block');
			$("#freezeMap").css('color', 'grey');
			$(".customZoomControl").css('color', '#ddd');
		}
	};

	/************** Map Layers ************/
	$scope.map.basemaps = [];

	/** click handler for datensätze button */
	$scope.map.showDatasets = function(){
		$scope.fields.cancel();
		if ($scope.sideContent.template === "app/templates/fgis/_datasets.html"){
			$scope.sideContent.change("");
		}
		else {
			$scope.sideContent.change("app/templates/fgis/_datasets.html");
		}
		try{$scope.map.editCancel();}catch(e){}
	};

	$scope.map.initBasemaps = function(){
        $scope.map.basemaps = [
					{ wms: 'https://sgx.geodatenzentrum.de/wms_topplus_open', layer: 'web', name: 'TopPlusOpen (alle Zoomstufen)' },
					{ wms: 'https://sgx.geodatenzentrum.de/wms_sen2europe', layer: 'rgb', name: 'Sentinel2: RGB Darstellung' },
					{ wms: 'https://www.wms.nrw.de/geobasis/wms_nw_dop', layer: 'nw_dop_rgb', name: 'NRW-Atlas: Luftbild DOP 20 cm' },
				//{ wms: 'https://www.wms.nrw.de/geobasis/wms_nw_abk ', layer: 'nw_abk_col', name: 'Amtliche Basiskarte 1:5.000 mit Kataster' },
			    { wms: 'http://{s}.tile.osm.org/{z}/{x}/{y}.png', layer: 'OpenStreetMap', name: 'OpenStreetMap' },
            { wms: '', layer: 'Lageplan', name: 'Lageplan' }
        ];
		// show default basemap
		$scope.map.showBasemap($scope.map.basemaps[0].wms, $scope.map.basemaps[0].layer);
	};

	$scope.map.showBasemap = function(wms, layer){
        var wmsLayer = null;
        if (layer === 'OpenStreetMap') {
            // Wurde vorab auf einem Lageplan gearbeitet, dann wird die Karte zurückgesetzt
            if ($scope.map.tileServer === 'Lageplan') $scope.resetMap();
            $scope.map.tileServer = '';
            wmsLayer = L.tileLayer(wms, {
                attribution: '&copy; <a href="http://osm.org/copyright">' + layer + '</a> contributors'
            });
            basemap.clearLayers();
            basemap.addLayer(wmsLayer);
        } else if(layer === 'Lageplan') {
            $('#lageplanDialog').show();
        } else {
            // Wurde vorab auf einem Lageplan gearbeitet, dann wird die Karte zurückgesetzt
            if ($scope.map.tileServer === 'Lageplan') $scope.resetMap();
            $scope.map.tileServer = '';
            wmsLayer = L.tileLayer.wms(wms, {
                layers: layer,
                format: 'image/png',
                transparent: false,
                attribution: '&copy; geobasis.nrw 2016'
            });
            basemap.clearLayers();
            basemap.addLayer(wmsLayer);
        }
	};

    /**
     * Before an 'lageplan' is added, the user is asked if he wants to remove the current data.
     * The user answered the question with 'yes'. In this case, the current data is deleted and the user can select a .jpg file.
     */
	$scope.insertLage = function () {
        $scope.resetMap();
        basemap.clearLayers();
        $scope.map.tileServer = 'Lageplan';
        // File Dialog
        dialog.showOpenDialog({
            title: 'Lageplan auswählen',
            // The filters specifies an array of file types that can be displayed or selected
            filters: [
                {name: 'JPG', extensions: ['jpg']}
            ]
        }, function (fileName) {
            if (fileName) {
                var bounds = [[51.4566245188, 7.3663709611], [51.5689107763,7.5681688339]];
                wmsLayer = L.imageOverlay(fileName[0], bounds, {
                    className: 'Lageplan'
                });
                basemap.addLayer(wmsLayer);
                map.fitBounds(bounds);
            }
        });
        $('#lageplanDialog').hide();
    };

    /**
     * Before an 'lageplan' is added, the user is asked if he wants to remove the current data.
     * If the user answers with "No", then the dialog is closed.
     */
    $scope.closeLageDialog = function () {
        $('#lageplanDialog').hide();
    };

    $scope.resetMap = function () {
        drawnItems.clearLayers();
        lines.clearLayers();
        linesArray = [];
        $scope.fields.delete();
        // All fields are reset
        for (var i = 0; i < $scope.fields.fieldOrder.properties.length; i++) {
            document.getElementById($scope.fields.fieldOrder.properties[i].id).innerHTML = getFieldHtmlString($scope.fields.fieldOrder.properties[i].id, '', '', '', '');
            $('#' + $scope.fields.fieldOrder.properties[i].id).removeClass("activated");
        }

        $scope.einsatz = {
            time: '',
            id: 0,
            drawnObjects: [],
            taktZeichen: [],
            map: {
                zoom: 0,
                center: {},
                tileServer: ''
            },
            metadata: {
                acronym: '',
                keyword: '',
                location: '',
                notify: '',
                number: '',
                date: ''
            },
            version: '',
            screen: ''
        };
    };

	/************** Map draw ************/

	$scope.map.editActive = false;
	$scope.map.currentEdit = "";

	$scope.map.draw = function(type){
		$scope.fields.cancel();
		var _className = 'leaflet-draw-draw-' + type;
		var _element = document.getElementsByClassName(_className);
		_element[0].click();
	};

	$scope.map.deleteObjects = function(){
		drawnItems.eachLayer(function(layer) {
			setClickable(layer, true);
		});

		$scope.map.editActive = true;
		$scope.map.currentEdit = "leaflet-draw-actions leaflet-draw-actions-bottom";
		var _element = document.getElementsByClassName("leaflet-draw-edit-remove");
		_element[0].click();
		$scope.sideContent.textvar = "Die zu löschenden Objekte bitte anklicken";
		$scope.sideContent.change("app/templates/fgis/_editObjects.html");
	};

	$scope.map.editObjects = function(){
		$scope.map.editActive = true;
		$scope.map.currentEdit = "leaflet-draw-actions leaflet-draw-actions-top";
		var _element = document.getElementsByClassName("leaflet-draw-edit-edit");
		_element[0].click();
		$scope.sideContent.textvar = "Objekte bearbeiten";
		$scope.sideContent.change("app/templates/fgis/_editObjects.html");
		$scope.map.objectId = "";
	};

	$scope.map.activateDrawInformation = function(){
		$scope.fields.cancel();
		drawnItems.eachLayer(function(layer) {
			setClickable(layer, true);
		});
	};

	$scope.map.objects = {};
	$scope.map.objects.measureString = "";
	$scope.map.objects.type = "";
	$scope.map.objects.comment = "";

	$scope.map.showComment = function(){
	    if ($scope.sideContent.template.includes('_drawnObject')) $scope.setColorPicker();

		$scope.map.objects.comment = commentsMap.get($scope.map.objectId);
		$scope.sideContent.change("app/templates/fgis/_drawnObject.html");
	};

	$scope.map.editCancel = function(){
		drawnItems.eachLayer(function(layer) {
			setClickable(layer, false);
		});
		$("#map").css('cursor', 'auto');
		$scope.map.editActive = false;
		var _element = document.getElementsByClassName($scope.map.currentEdit);
		_element[0].children[1].children[0].click();
		$scope.map.objectId = "";
		$scope.sideContent.close();
	};

	$scope.map.editSave = function(){
		drawnItems.eachLayer(function(layer) {
			setClickable(layer, false);
		});
		$("#map").css('cursor', 'auto');
		$scope.map.editActive = false;
		var _element = document.getElementsByClassName($scope.map.currentEdit);
		_element[0].children[0].children[0].click();
		$scope.map.objectId = "";
		commentsMap['delete']($scope.map.objectId);
		$scope.sideContent.close();
	};

	$scope.map.saveGeomSettings = function () {
		// layer
		var layer = drawnItems.getLayer($scope.map.objectId);
		// checkbox state
		var checkboxstateLabel =  $('#labelGeometry').is(':checked');
		var checkboxstateDashedLine = $('#dashed').is(':checked');
		var selectedColor = $("#colorPicker").spectrum('get').toHexString();
		// set comment
		commentsMap.set($scope.map.objectId, $scope.map.objects.comment);
		// Removes the tooltip previously bound with bindTooltip. The previous tooltip must be removed first before a new one is added.
		// Otherwise several tooltips will be displayed on the map.
		layer.unbindTooltip();
		layer.options['showTooltip'] = false;
		if (checkboxstateLabel && $scope.map.objects.comment.trim() != '') {
			// Binds a tooltip to the layer with the passed content
			layer.bindTooltip($scope.map.objects.comment, {
				permanent: true,
				className: 'customTooltip'
			}).openTooltip();
			layer.options['showTooltip'] = true;
		}
		if ($scope.geomType != 'point') {
			// change colour
			if (checkboxstateDashedLine) {
				layer.setStyle({color: selectedColor, dashArray: [20, 15]});
			} else {
				layer.setStyle({color: selectedColor, dashArray: null});
			}
		}
	};

	$scope.map.objects.getMeasurement = function(type, layer){
		var htmlString = "";
		var area = null;
		var length = null;
		var typeOf = "";
		var qm = null;
		var qkm = null;
		var ha = null;

		// type can be a leaflet type, or a GeoJSON type, so we have to catch both
		switch (type.toLowerCase()) {
			case "rectangle":
				typeOf = "<h4>Typ: Rechteck</h4>";
				area = L.GeometryUtil.geodesicArea(layer.getLatLngs()[0]);
				break;
			case "polygon":
				typeOf = "<h4>Typ: Polygon</h4>";
				area = L.GeometryUtil.geodesicArea(layer.getLatLngs()[0]);
				break;
			case "circle":
				typeOf = "<h4>Typ: Kreis</h4>";
				area = Math.PI * Math.pow(layer.getRadius(), 2);
				break;
			case "polyline":
			case "linestring":
				typeOf = "<h4>Typ: Polylinie</h4>";
				length = L.GeometryUtil.accumulatedLengths(layer.getLatLngs());
				length = length[length.length - 1];
				break;
			case "marker":
			case "point":
				typeOf = "<h4>Typ: Punkt</h4>";
				break;
		}

		if (area != null) {
			ha = Math.floor(area / 10000);
			if (area < 1000000) {
				qm = Math.floor(area);
				htmlString = "<h4>Fläche: " + qm + " m<sup>2</sup> / " + ha + " ha</h4>";
			} else {
				qkm = Math.floor(area / 1000000);
				htmlString = "<h4>Fläche: " + ha + " ha / " + qkm + " km<sup>2</sup></h4>";
			}
		}
		if (length != null) {
			if (length < 10000) {
				htmlString = "<h4>Länge: " + Math.floor(length) + "m</h4>";
			} else {
				htmlString = "<h4>Länge: " + Math.floor(length / 100) / 10 + "km</h4>";
			}
		}
		$scope.map.objects.measureString = $sce.trustAsHtml(htmlString + typeOf);
		// $scope.map.objects.type = _type;
	};


	/********* INIT **********/

	$scope.map.initBasemaps();

	/** load the einsatz which is specified in the URL hash, when the controller is fully initialized */
	$scope.$on('$viewContentLoaded', function(){
	    var einsatzID = decodeURIComponent(window.location.hash).split('map/').pop();
		// var einsatzID = window.location.hash.split('/').pop();
		if (['', 'map'].indexOf(einsatzID) == -1) $scope.loadEinsatz(einsatzID);
	});
});

/**
 * @desc calculates coordinates for the anchor point (centered to the TZ slot) of the lines to be drawn correctly on map
 * @param elementId: ID of html element for which anchor point will get calculated.
 * @return calculated coordinates
 */
function getAnchorOfElement(elementId){
	if (elementId) {
		var _this = $("#"+elementId);
		var _map = $("#map");
		var _mapTop = _map.offset().top;
		var _mapLeft = _map.offset().left;
		var _mapWidth = parseInt(_map.css('width'), 10);
		var _mapHeight = parseInt(_map.css('height'), 10);
		var offset = _this.offset();
		var width = _this.width();
		var height = _this.height();
		var centerX = offset.left + width / 2;
		var centerY = offset.top + height / 2;

		// left column:
		if(centerX < _mapLeft) return [2, centerY - _mapTop];
		//right column:
		else if (centerX > _mapLeft + _mapWidth - 1) return [offset.left - _mapLeft, centerY - _mapTop];
		//top row:
		else if (centerY < _mapTop + 1 ) return [centerX - _mapLeft, 2];
		// bottom row:
		else if (centerY > _mapTop + _mapHeight - 1) return [centerX - _mapLeft, offset.top - _mapTop];
	}

}

/****************************************
************** Map Stuff ****************
*****************************************/

function initMap(){
	map = L.map('map', {
		zoomControl: true
	}).setView([51.50, 7.6], 8);
	L.control.scale({
		position: 'bottomright',
		metric: true,
		imperial: false
		}).addTo(map);

	lines = L.layerGroup().addTo(map);
	basemap = L.layerGroup().addTo(map);
	drawnItems = new L.FeatureGroup();
	map.addLayer(drawnItems);

	var drawOptions = {
		position: 'topright',
		draw: {
			polyline: {
				shapeOptions: { color: '#ff0000', clickable: false }
			},
			polygon: {
				allowIntersection: true,
				shapeOptions: { color: '#ff0000',  clickable: false },
				showArea: true
			},
			rectangle: {
				shapeOptions: { clickable: false,  color: '#ff0000' }
			},
			marker: {
				shapeOptions: { clickable: false } // doesn´t work, leaflet draw bug
			},
			circle: {
				shapeOptions: { color: '#ff0000', clickable: false }
			}
		},
		edit: {
			featureGroup: drawnItems, //REQUIRED!!
			remove: true
		}
	};

	drawControl = new L.Control.Draw(drawOptions);
	map.addControl(drawControl);
}

/**
* @desc sets option 'clickable' for a leaflet layer to value
*/
function setClickable(layer, value) {
	var elemMap = $('#map');
	if (value) {
		elemMap.css('cursor', 'help');
		layer.options.clickable = value;
	} else {
		elemMap.css('cursor', 'auto');
		layer.options.clickable = value;
	}
}

//fuction to relocate all lines to their anchor-points
function fitAllLines(linesArray){
	lines.clearLayers();
	for (var i = linesArray.length - 1; i >= 0; i--) {
		try {
			var p1 = null;
			// Wenn das Element einem Vater zugeordnet ist, dann müssen die Koordinaten in LatLng umgewandelt werden
			if (linesArray[i][2] != null) p1 = map.containerPointToLatLng(getAnchorOfElement(linesArray[i][2]));
			else p1 = linesArray[i][0];
			var p2 = map.containerPointToLatLng(getAnchorOfElement(i));
			var latlngs = [p1, p2];
			lines.addLayer(L.polyline(latlngs));
		} catch(e){
			// do nothing, because the linesArray will have holes
		}
	}
}

/****************************************
************ Drag and Drop **************
*****************************************/

function drag(ev){
	var startId = ev.target.id.split("e");
	ev.dataTransfer.setData("text", startId[1]);
}

function allowDrop(ev) {
	ev.preventDefault();
}

/**
 * @desc    generates the html string for a field, identified by its kranzposition
 * @returns html string to be placed within the fields div
 * @example $('<div class="field" id="12"</div>').append(getFieldHtmlString('12'));
 */
function getFieldHtmlString(kranzposition, svgPath , comment, textTop, textBottom) {

	var _textTop = '<div id="fieldTextTop' + kranzposition
		+ '" class="fieldText fieldTextTop" style="overflow:hidden" title="'
		+ textTop + '" data-toggle="tooltip">' + textTop + '</div>';

	var _textBottom = '<div id="fieldTextBottom' + kranzposition
		+ '" class="fieldText fieldTextBottom" style="overflow:hidden" title="'
		+ textBottom + '" data-toggle="tooltip">' + textBottom + '</div>';

	var _comment = '<div id="fieldComment' + kranzposition + '" class="fieldComment">'
		+ comment + '</div>';

	// insert TZ if a path is given, else create a "NA" polygon
	var _image = '';
	if (svgPath) {
		_image = '<img id="image' + kranzposition + '" draggable="true" ondragstart="drag(event)" src="'
			+ svgPath + '" style="height:' + fieldOrder.size + '; width:' + fieldOrder.size
			+ '; background-color: white; text-align: center;" />';
	} else {
		_image = '<svg id="image' +  kranzposition + '" viewBox="0 0 89 89" preserveAspectRatio="none" style="height:'
			+ fieldOrder.size + '; width:' + fieldOrder.size
			+ ';"><polygon points="2,2 88,2 88,88 2,88 2,2 2,22.5 88,22.5 88,67.5 2,67.5"/></svg>';
	}

	return _textTop + _textBottom + _comment + _image;
}
