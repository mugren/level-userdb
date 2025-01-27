var async = require('async')
var db = require('../db')
var expect = require('chai').expect
var rimraf = require('rimraf')

describe('db', function() {

  var dbi
  var nonExistantEmail = 'test@example.com'
  var existantEmail = 'test-exists@example.com'
  var password = 'test123'
  var data = { some:"data" }

  after(function(done) {
    rimraf('level-userdb.db', function() { done() })
  })

  before(function(done) {
    rimraf('level-userdb.db', function() {
      dbi = db()
      dbi.addUser(existantEmail, password, data, function() {
        done()
      })
    })
  })

  it('should export correct API', function(done) {
    var methods = ['findUser', 'addUser', 'checkPassword', 'changeEmail',
      'changePassword', 'deleteUser', 'modifyUser']
    methods.forEach(function(method) {
      expect(dbi).property(method)
    })
    done()
  })


  describe('#findUser', function() {


    it('should return NotFoundError on missing user', function(done) {
      dbi.findUser(nonExistantEmail, function(err, user) {
        expect(err).to.have.property('name', 'NotFoundError')
        done()
      })
    })

    it('should return user a well-formed user object for existing user', function(done) {
      dbi.findUser(existantEmail, function(err, user) {
        expect(err).to.be.null
        // verify the metadata is stored
        expect(user.data).eql(data)
        // verify we parse the ISO8601 timestamps back to JS
        expect(user.modifiedDate).to.be.a('Date')
        expect(user.createdDate).to.be.a('Date')
        // verify we hash the password
        expect(user.password).to.not.eql(password)
        // verify we have the email in the user object
        expect(user.email).to.eql(existantEmail)
        done()
      })
    })

  })

  describe('#checkPassword', function() {

    it('should not error on password match', function(done) {

      dbi.checkPassword(existantEmail, password, function(err, res) {
        expect(err).to.be.null
        expect(res).to.have.property('password')
        done()
      })
    })

    it('should throw error on password mis-match', function(done) {

      dbi.checkPassword(existantEmail, "BADPASSWORD", function(err, res) {
        expect(err).to.eql("password mismatch")
        expect(res).to.be.false
        done()
      })
    })
  })

  describe('#changeEmail', function() {
    var origEmail = 'orig@example.com'
    var newEmail = 'new@example.com'

    var origModifiedTimestamp
    var newModifiedTimestamp

    before(function(done) {
      dbi.addUser(origEmail, password, {some:"data"}, function(err) {
        dbi.findUser(origEmail, function(err, user) {
          origModifiedTimestamp = user.modifiedTimestamp
          done()
        })
      })
    })

    it('should update email correctly', function(done) {
      dbi.changeEmail(origEmail, newEmail, function(err) {
        dbi.findUser(newEmail, function(err, user) {
          expect(err).to.be.null
          expect(user).to.not.be.null
          newModifiedTimestamp = user.modifiedTimestamp
          dbi.checkPassword(newEmail, password, function(err, res) {
            expect(res.password).to.exist
            done()

          })
        })
      })
    })

    it('should update modifiedTimestamp correctly', function(done) {
      expect(newModifiedTimestamp).to.not.eql(origModifiedTimestamp)
      done()
    })

  })

  describe('#changePassword', function() {

    var origEmail = 'cpemail@example.com'
    var origPassword = 'supersecret'
    var newPassword = 'blahr'

    var user

    before(function(done) {
      dbi.addUser(origEmail, origPassword, {some:"data"}, function(err) {
        dbi.findUser(origEmail, function(err, u) {
          user = u
          done()
        })
      })
    })

    it('should update password correctly', function(done) {
      dbi.checkPassword(origEmail, origPassword, function(err, res) {
        expect(res.password).to.exist
        dbi.changePassword(origEmail, newPassword, function(err, res) {
          dbi.checkPassword(origEmail, origPassword, function(err, res) {
            expect(err).to.eql('password mismatch')
            expect(res).to.be.false
            dbi.checkPassword(origEmail, newPassword, function(err, res) {
              expect(res.password).to.exist
              done()
            })
          })
        })
      })
    })

  })

  describe('#deleteUser', function() {

    var testEmail = 'cpemail-deleteUser@example.com'
    var testPassword = 'supersecret'

    it('should successfully delete a user', function(done) {

      function add() {
        dbi.addUser(testEmail, testPassword, {some:"foobar"}, verifyAdd)
      }

      function verifyAdd() {
        dbi.findUser(testEmail, function(err, user) {
          expect(err).to.be.null
          expect(user.password).to.not.be.null
          del()
        })
      }

      function del() {
        dbi.deleteUser(testEmail, verifyDel)
      }

      function verifyDel() {
        dbi.findUser(testEmail, function(err, user) {
          expect(err).to.not.be.null
          expect(user).to.be.undefined
          done()
        })
      }

      add()

    })
  })

  describe('#modifyUser', function() {
    var testEmail = 'cpemail-modifyUser@example.com'
    var testPassword = 'supersecret'
    var data1 = {woot:"foobar", zzz:[1,2,3]}
    var data2 = {blah:"blahbalh", deepObj:{some:"data"}}

    it("should successfully modify a user's data property", function(done) {

      function add() {
        dbi.addUser(testEmail, testPassword, data1, verifyAdd)
      }

      function verifyAdd() {
        dbi.findUser(testEmail, function(err, user) {
          expect(err).to.be.null
          expect(user.password).to.not.be.null
          expect(user.data).to.eql(data1)
          modify()
        })
      }

      function modify() {
        dbi.modifyUser(testEmail, data2, verifyModify)
      }

      function verifyModify() {
        dbi.findUser(testEmail, function(err, user) {
          expect(user.data).to.eql(data2)
          done()
        })
      }
      add()
    })

  })

  describe('writeQueue', function() {
    var testEmail1 = 'writeQueue@example.com'
    var testEmail2 = 'writeQueue2@example.com'
    var testPassword = 'testblalbha'
    var testPassword2 = 'testblalbha2'
    var data = {woot:"foo"}

    it('should serialize multi-step write-after-read operations', function(done) {
      function add() {
        dbi.addUser(testEmail1, testPassword, data, modify)
      }

      // Here we modify the same record in parallel, hoping to create a race condition.
      function modify() {

        async.parallel([
          function(cb) {
            dbi.changeEmail(testEmail1, testEmail2, function(err) {
              cb(null, err)
            })
          },
          function(cb) {
            dbi.changePassword(testEmail1, testPassword2, function(err) {
              cb(null, err)
            })
          },
          function(cb) {
            dbi.changePassword(testEmail2, testPassword2, function(err) {
              cb(null, err)
            })
          },
        ], function(err, res) {
          var found = 0
          res.forEach(function(item) {
            if (item && item.name === "NotFoundError") found++
          })
          expect(found).to.eql(1)
          done()
        })

      }

      add()
    })

  })

  describe('#createUserStream', function() {
    var baseEmail = 'createUserStream@example.com'
    var password = 'mysecret'
    var data = {some:"data"}

    it('should return a stream of user objects', function(done) {
      this.timeout(20000)
      // Insert 20 users
      var NUM_USERS = 20

      var i = 0
      async.whilst(async function test() { return i < NUM_USERS }, async function iter(cb) {
          dbi.addUser(i + '-' + baseEmail, password, data, cb)
          i++
        }, setTimeout(start, 2000)
      )

      var cnt = 0
      function start() {
        dbi.createUserStream()
          .on('data', function(user) {
            expect(user).to.exist
            expect(user.email).to.be.a('string')
            expect(user.password).to.be.a('string')
            expect(user.modifiedDate).to.be.a('date')
            expect(user.createdDate).to.be.a('date')
            expect(user.data).to.be.a('object')
            cnt++
          })
          .on('end', function() {
            expect(cnt).to.be.above(NUM_USERS)
            done()
          })
      }
    })

  })

})
