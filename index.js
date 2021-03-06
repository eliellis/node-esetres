var http = require('http');
var https = require('https');
var crypto = require('crypto');
var fs = require('fs');
var sax = require('sax');

function SThree(opts){
	this.bucket = opts.bucket;
	this.key = opts.key;
	this.secret = opts.secret;
	this.secure = opts.secure || true;
	this.region = opts.region || 'us-standard';
	this.baseUrl = opts.baseUrl || null;
	return this;
}

SThree.prototype.getBucket = function(headers, callback){
	if (typeof headers === 'function'){
		callback = headers;
		headers = {};
	}

	this._request('GET', '/', headers, function(err, parsed){
		var list = [];
		var rKeys = Object.keys(parsed);
		for (var i = 0; i < parsed.Key.length; i++) {
			var item = {};
			for (var d = 0; d < rKeys.length; d++) {
				item[rKeys[d]] = (typeof parsed[rKeys[d]] === 'string') ? parsed[rKeys[d]] : parsed[rKeys[d]][i];
			}
			list.push(item);
		}
		callback(err, list);
	}).end();
};

SThree.prototype.head = function(name, headers, callback){
	this._request('HEAD', name, headers, callback).end();
};

SThree.prototype.get = function(name, headers, callback){
	this._request('GET', name, headers, callback).end();
};

SThree.prototype.put = function(data, name, headers, callback){
	if (Buffer.isBuffer(data)){
		this._request('PUT', name, headers, callback).end(data);
	}
	else if (Object.prototype.toString.call(data) === '[object String]'){
		var buff = new Buffer(data); // inneficient for large strings, but the least ineficient at getting byte-length
		var initializationHeaders = {"Content-Type": "text/plain", "Content-Length" : buff.length};
		if (typeof headers === 'function'){
			callback = headers;
			headers = initializationHeaders;
		}
		else{
			headers = this._extend(headers, initializationHeaders);
			console.log(headers);
		}
		this._request('PUT', name, headers, callback).end(buff);
	}
	else{
		data.pipe(this._request('PUT', name, headers, callback));
	}
};

SThree.prototype.delete = function(name, headers, callback){
	this._request('DELETE', name, headers, callback).end();
};

SThree.prototype._request = function(method, path, headers, fn){
		var self = this;
		// assume last argument is the callback
		if (typeof headers === 'function'){
			fn = headers;
			headers = {};
		}

		var now = new Date();
		headers.Date = now.toUTCString();
		headers.Authorization = 'AWS ' + this.key + ':' +
		this._makeAuthorizationHeader(
			method.toUpperCase(),
			this._header(headers, 'content-md5'),
			this._header(headers, 'content-type'),
			now,
			this.bucket,
			path,
			this._getAwsHeaders(headers)
		);

		var params = {
			method: method.toUpperCase(),
			host: this.bucket + '.' + this._regionHost(),
			path: path,
			agent: false, // connection pooling issue
			headers: headers
		};

		var interface = ((this.secure) ? https : http);

		var s3Request = interface.request(params, function(res){
			if (res.headers['content-type'] === 'application/xml'){
				self._looseParse(res, function(err, object){
					fn(err, object);
				});
			}
			else{
				fn(null, res);
			}
		});

		s3Request.on('error', fn);
		return s3Request;
};

SThree.prototype._looseParse = function(stream, fn){
	var parse = new sax.createStream(true, {normalize: true, trim: true});
	var depth = [];
	var nodes = {};
	parse.on('opentag', function(tag){
		depth.push(tag.name);
	});
	parse.on('endtag', function(name){
		var i = depth.indexOf(name);
		if (i !== -1){
			depth.splice(i,1);
		}
	});
	parse.on('text', function(text){
		if (typeof nodes[this._parser.tag.name] === 'string'){
			nodes[this._parser.tag.name] = [nodes[this._parser.tag.name], text];
		}
		else{
			nodes[this._parser.tag.name] = text;
		}
	});
	parse.on('error', fn);
	parse.on('end', function(){
		fn(null, nodes);
	});
	stream.pipe(parse);
};

SThree.prototype._regionHost = function(){
	if (this.region === 'us-standard') {
		return 's3.amazonaws.com';
	}
	else if (this.region !== 'us-standard'
			&& this.baseUrl != null) {
		// the case we are using some other S3-like provider
		// e.g. DigitalOcean, Zenko CloudServer
		return `${ this.region }.${ this.baseUrl }`;
	}
	else {
		return `s3-'${ this.region }.amazonaws.com`;
	}
};

SThree.prototype._header = function(obj, name){
	var oKs = Object.keys(obj);
	for (var i = 0; i < oKs.length; i++) {
		if (oKs[i].toLowerCase() === name){
			return obj[oKs[i]];
		}
	}
	return null;
};

SThree.prototype._extend = function(one, two, copy){
	if (typeof one === 'object' && typeof two === 'object'){
		if (copy) {
			var delegateObj = {};

			var initialKeys = Object.keys(one);
			for (var i = 0; i < initialKeys.length; i++) {
				delegateObj[initialKeys[i]] = one[initialKeys[i]];
			}

			var extendWithKeys = Object.keys(two);
			for (i = 0; i < extendWithKeys.length; i++) {
				delegateObj[extendWithKeys[i]] = two[extendWithKeys[i]];
			}

			return delegateObj;
		}
		else{
			var toExtendKeys = Object.keys(two);
			for (var h = 0; h < toExtendKeys.length; h++) {
				one[toExtendKeys[h]] = two[toExtendKeys[h]];
			}
			return one;
		}
	}
	else{
		throw new Error('One or both of the two function arguments were not of type "object"');
	}
};

SThree.prototype._getAwsHeaders = function(headers){
	var hNames = Object.keys(headers);
	hNames = hNames.filter(function(item){
		if (item.substr(0,5).search('x-amz') === -1){
			return false;
		}
		else{
			return true;
		}
	});
	var withVals = {};
	for (var i = 0; i < hNames.length; i++) {
		withVals[hNames[i]] = headers[hNames[i]];
	}
	return withVals;
};

SThree.prototype._canonicalizeAmazonHeaders = function(headers){
	var amzK = Object.keys(headers);
	var has = [];
	for (var i = 0; i < amzK.length; i++) {
		var key = amzK[i];
		var value = headers[amzK[i]];
		key = key.toLowerCase();
		has.push(key + ':' + value);
	}
	return has.sort();
};

SThree.prototype._makeAuthorizationHeader = function(method, md5, contentType, date, bucket, resource, amzHeaders){
	var stringToSign =
	[
		method,
		md5,
		contentType,
		date.toUTCString(),
		this._isEmpty(amzHeaders) ? '' : this._canonicalizeAmazonHeaders(amzHeaders).join('\n'),
		'/' + bucket + resource
	];

	for (var i = 0; i < stringToSign.length; i++){
		if (stringToSign[i] === ''){
			stringToSign.splice(i, 1);
		}
	}

	return crypto.createHmac('sha1', this.secret).update(stringToSign.join('\n')).digest('base64');
};

SThree.prototype._isEmpty = function(object){
    for (var k in object)
       if (object.hasOwnProperty(k))
           return false;
    return true;
};

SThree.prototype.generatePolicyFromObject = function(object){
	return new Buffer(JSON.stringify(object)).toString('base64');
};

SThree.prototype.generateSignatureFromPolicyString = function(policy){
	return crypto.createHmac('sha1', this.secret).update(policy).digest('base64');
};

module.exports = function(opts){
	return new SThree(opts);
};