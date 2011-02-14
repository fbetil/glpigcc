var bgPage = chrome.extension.getBackgroundPage();
var extVar = new Object();

if (this != bgPage) { extVar = bgPage.extVar }

// Function d'initialisation de l'extension
function initExtension() {
	extVar.GlpiWebservicesUrl = "/plugins/webservices/xmlrpc.php";
	extVar.GlpiIndexPageUrl = "/index.php";
	extVar.GlpiLoginPageUrl = "/login.php";
	extVar.GlpiLoginPageTitle = "GLPI - Login";
	extVar.GlpiCssUrl = "/css/styles.css";
	extVar.GlpiGlobalSearchIcon = "/pics/ok2.png";
	
	extVar.unreadCount = 0;
	extVar.connectionState = 0;	// 0=>NotConnected, 1=>ConnectionInProgress, 2=>Connected
	extVar.glpiResultLimit = 9999999;
	extVar.glpiSession = '';
	extVar.glpiUserId = 0;
	extVar.glpiUserLongName = '';
	extVar.loginOrder = new Array();
	extVar.loginMethod = '';
	extVar.lastUpdateTime = null;
	extVar.pauseExecution = false;
	extVar.executionForced = false;
	extVar.executionInProgress = false;
	
	extVar.newTickets = new Array();
	extVar.assignTickets = new Array();
	extVar.filterGridParams = new Object();
	
	extVar.GlpiVersion = '';
	extVar.GlpiWebservicesVersion = '';
}

// Fonction de démarrage du Timer
function resetTimer(interval) {
	setTimeout("getTracking();", interval);
}

// Fonction de récupération des données
function getTracking(force) {
	if (extVar.executionInProgress == true) { return false; }
	if (extVar.executionForced == true && force == null) { return false; }
	if (extVar.pauseExecution == true && force == null) { return false; }

	if (force == true) {extVar.executionForced = true}
	
	extVar.executionInProgress = true;
	
	// Récupération des nouveaux Tickets
	extVar.newTickets = listTickets({"status":"new", "id2name":true, "limit": extVar.glpiResultLimit});
		
	// Récupération des Tickets attribués
	if (extVar.GlpiWebservicesVersion == "1.0.0") {	//Gestion de la v1.0.0 qui ne permet pas de récupérer directement les tickets dont on est chargé
		extVar.assignTickets = new Array();
		tmpTickets = listTickets({"status":"assign", "id2name":true, "limit": extVar.glpiResultLimit});
		for (var ticket = 0; ticket<tmpTickets.length;ticket++){	//Filtre de la liste pour récupérer mes tickets
			if (tmpTickets[ticket].users_id_assign == extVar.glpiUserId) { extVar.assignTickets.push(tmpTickets[ticket]); }
		}
	}else if(extVar.GlpiWebservicesVersion == "1.0.1") {
		extVar.assignTickets = listTickets({"status":"assign", "users_id_assign": extVar.glpiUserId, "id2name":true, "limit": extVar.glpiResultLimit});
	}
	
	extVar.lastUpdateTime = new Date();

	if (extVar.executionForced == false) {
		resetTimer(localStorage.SyncInterval * 60000);
	} else {
		extVar.executionForced = false;
	}
	
	extVar.executionInProgress = false;
}

// Detection installation correcte
function checkInstall() {
	var status = getServeurStatus();
	
	if (!status) { return false };
	
	extVar.GlpiVersion = status.glpi.toString();
	extVar.GlpiWebservicesVersion = status.webservices.toString();
	
	return (localStorage.GlpiRootUrl && localStorage.SyncInterval && localStorage.AuthSso && localStorage.AuthHook && localStorage.AuthUsername && localStorage.AuthPassword);
}

// Récupération d'informations de config du serveur
function getServeurStatus(url){
	var status = sendRequest('glpi.test', null, url);

	if (!status || status.faultCode) {
		return false;
	} else {
		return status;
	}
}

// Fonction de recherche d'un message de langue
function getMessage(id,args) {
	if (args == null) {
		args = [""];
	}
	return chrome.i18n.getMessage(id, args);
}

// Fonction de traduction de la page
function parseMessage(template) {
	var labels = template.document.getElementsByTagName('LABEL');
	
	for (var label = 0; label<labels.length;label++){
		labels[label].innerHTML = getMessage(labels[label].getAttribute("id"),labels[label].getAttribute("value"));
	}
}

// Fonction d'envoi d'une requete XML-RPC
function sendRequest(method, args, url) {
	try {
		if (!url) { url = localStorage.GlpiRootUrl + extVar.GlpiWebservicesUrl }
		var request = new XmlRpcRequest(url, method);
		if (args) { request.addParam(args) }
		var response = request.send();
		var data = response.parseXML();
		return data;
	}catch (err){
		return false;
	}
}

// Fonction de connexion
function doLogin(method) {
	extVar.connectionState = 1;
	setIcon();
	
	switch (method) {
		case 'hook':
			extVar.loginOrder.shift();	// On supprime le premier élément du tableau
			hookSession();
			break;
			
		case 'cookie':
			if (extVar.glpiSession != "") {
				if (getMyInfo() == true) {
					if (extVar.loginMethod == '') { extVar.loginMethod = getMessage("labelLoginMethodHook"); }
					extVar.connectionState = 2;
					setIcon();
					return true;
				}
			}else{
				doLogin(extVar.loginOrder[0]);	// Si echec on appelle la methode suivante
			}
			break;
		
		case 'sso':
			extVar.loginOrder.shift();	// On supprime le premier élément du tableau
			
			//Appel de la page d'initialisation de la session
			var xhr = new XMLHttpRequest();
			xhr.open("GET", localStorage.GlpiRootUrl + extVar.GlpiIndexPageUrl, false);
			xhr.send();
			
			//Appel de la page de login
			var xhr = new XMLHttpRequest();
			xhr.open("GET", localStorage.GlpiRootUrl + extVar.GlpiLoginPageUrl, false);
			xhr.onreadystatechange = function() {
				if (xhr.readyState == 4) {
					// Si on n'est pas renvoyé sur la page de login, le SSO à fonctionné, on appelle le Hook
					if (xhr.responseText.indexOf("<title>" + extVar.GlpiLoginPageTitle + "</title>") == -1) {
						extVar.loginMethod = getMessage("labelLoginMethodSso");
						extVar.loginOrder.unshift("hook");		// On réinsère le premier élement du tableau
						doLogin(extVar.loginOrder[0]);
					}else{
						doLogin(extVar.loginOrder[0]);
					}
				}
			}
			xhr.send();
			
			break;
			
		case 'classic':
			extVar.loginOrder.shift();	// On supprime le premier élément du tableau
			
			var args = {"login_name": localStorage.AuthUsername, "login_password": localStorage.AuthPassword };
			var _doLogin = sendRequest('glpi.doLogin', args);

			if (!_doLogin || _doLogin.faultCode) {
				extVar.glpiUserLongName = '';
				extVar.glpiUserId = 0;
				extVar.glpiSession = '';
				extVar.connectionState = 0;
				setIcon();
				return false;
			}else{
				extVar.loginMethod = getMessage("labelLoginMethodClassic");
				extVar.glpiUserLongName = _doLogin.firstname.toString() + " " + _doLogin.realname.toString();
				extVar.glpiUserId = parseInt(_doLogin.id.toString());
				extVar.glpiSession = _doLogin.session.toString();
				extVar.connectionState = 2;
				setIcon();
				return true;
			}
			break;
		
		case 'init':
			extVar.loginOrder = new Array();
			extVar.loginMethod = '';
		
			// On stock les différente méthode d'authentification
			if (localStorage.AuthHook == "true") { extVar.loginOrder.push("hook"); }
			if (localStorage.AuthSso == "true") { extVar.loginOrder.push("sso"); }
			if (true) { extVar.loginOrder.push("classic"); }	// On finit toujours par la méthode "classique"

			doLogin(extVar.loginOrder[0]);	// On appelle la methode
			
			break;
	}
}

// Fonction de récupération de la session actuelle
function hookSession() {
	var i = 0;
	var oUrl = parseUri(localStorage.GlpiRootUrl);
	
	chrome.cookies.get( {"url": oUrl.protocol + '://' + oUrl.domain + '/', "name":"PHPSESSID"}, function cookieRegister(cookie) {
		try {
			extVar.glpiSession = cookie.value;
		} catch(err){
			extVar.glpiSession = '';
		} finally {
			doLogin('cookie');
		}
		
	});
}

// Fonction de connexion
function getMyInfo() {

	var args = {"session": extVar.glpiSession };
	var _getMyInfo = sendRequest('glpi.getMyInfo', args);

	if (!_getMyInfo.faultCode) {
		extVar.glpiUserLongName = _getMyInfo.firstname.toString() + " " + _getMyInfo.realname.toString();
		extVar.glpiUserId = parseInt(_getMyInfo.id.toString());
		return true;
	}else{
		extVar.glpiUserLongName = '';
		extVar.glpiUserId = 0;
		extVar.glpiSession = '';
		extVar.connectionState = 0;
		setIcon();
		return false;
	}
}

// Fonction de récupération des tickets
function listTickets(args) {
	args.session = extVar.glpiSession;
	var _listTickets = sendRequest('glpi.listTickets', args);

	if (!_listTickets.faultCode) {
		return _listTickets;
	}else{
		return false;
	}
}

// Fonction de modification de l'icone
function setIcon() {
	switch (extVar.connectionState) {
		case 0:
			chrome.browserAction.setBadgeBackgroundColor({ color: [192, 0, 0, 255] });
			chrome.browserAction.setBadgeText({ text: "X" });
			chrome.browserAction.setTitle({ title: getMessage("iconNotConnected") });
			break;
		case 1:
			chrome.browserAction.setBadgeBackgroundColor({ color: [190, 190, 190, 255] });
			chrome.browserAction.setBadgeText({ text: "..." });
			chrome.browserAction.setTitle({ title: getMessage("iconLoadingData") });
			break;
		case 2:
			chrome.browserAction.setBadgeBackgroundColor({ color: [127, 176, 48, 255] });
			chrome.browserAction.setBadgeText({ text: extVar.unreadCount.toString() });
			chrome.browserAction.setTitle({ title: getMessage("iconConnected", extVar.glpiUserLongName + ' (' + extVar.loginMethod + ')') });
			break;
	}
}

/* parseUri JS v0.1, by Steven Levithan (http://badassery.blogspot.com)
Splits any well-formed URI into the following parts (all are optional):
----------------------
• source (since the exec() method returns backreference 0 [i.e., the entire match] as key 0, we might as well use it)
• protocol (scheme)
• authority (includes both the domain and port)
    • domain (part of the authority; can be an IP address)
    • port (part of the authority)
• path (includes both the directory path and filename)
    • directoryPath (part of the path; supports directories with periods, and without a trailing backslash)
    • fileName (part of the path)
• query (does not include the leading question mark)
• anchor (fragment)
*/
function parseUri(sourceUri){
    var uriPartNames = ["source","protocol","authority","domain","port","path","directoryPath","fileName","query","anchor"];
    var uriParts = new RegExp("^(?:([^:/?#.]+):)?(?://)?(([^:/?#]*)(?::(\\d*))?)?((/(?:[^?#](?![^?#/]*\\.[^?#/.]+(?:[\\?#]|$)))*/?)?([^?#/]*))?(?:\\?([^#]*))?(?:#(.*))?").exec(sourceUri);
    var uri = {};
    
    for(var i = 0; i < 10; i++){
        uri[uriPartNames[i]] = (uriParts[i] ? uriParts[i] : "");
    }
    
    // Always end directoryPath with a trailing backslash if a path was present in the source URI
    // Note that a trailing backslash is NOT automatically inserted within or appended to the "path" key
    if(uri.directoryPath.length > 0){
        uri.directoryPath = uri.directoryPath.replace(/\/?$/, "/");
    }
    
    return uri;
}
