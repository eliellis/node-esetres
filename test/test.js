var triples = require('../index.js');
var config = require('./config');
var fs = require('fs');

var s3 = triples({
	key: config.accessKey,
	secret: config.secretAccessKey,
	bucket: config.bucket
});

var filename = "hipster.txt";

describe('Triples', function(){

	describe('#put()', function(){
		it('should put a stream into S3 with no problems', function(done){
			this.timeout(0); // we're uploading a file, so chill bro
			fs.stat(filename, function(err, stat){
				var file = fs.createReadStream(filename);
				s3.put(file, '/' + filename, {'content-length': stat.size, 'content-type': 'text/plain'}, done);
			});
		});
	});

	describe('#get()', function(){
		it('should get a stream from S3 with no problems', function(done){
			this.timeout(0); // we're download a file, yeah
			s3.get('/' + filename, done);
		});

		it('should list all files in a bucket', function(done){
			this.timeout(0); // we're download a file, yeah
			s3.getBucket(function(err, list){
				if (Array.isArray(list) && !err){
					done();
				}
				else{
					done(err || new Error('The returned value was not an Array'));
				}
			});
		});
	});

});