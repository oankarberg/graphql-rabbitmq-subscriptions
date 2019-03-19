"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var chai = require("chai");
var chaiAsPromised = require("chai-as-promised");
var server_1 = require("@cdm-logger/server");
var rabbitmq_pub_sub_1 = require("rabbitmq-pub-sub");
var graphql_1 = require("graphql");
var graphql_subscriptions_1 = require("graphql-subscriptions");
var amqp_pubsub_1 = require("../amqp-pubsub");
var logger = server_1.ConsoleLogger.create('integration-test', { level: 'trace' });
chai.use(chaiAsPromised);
var expect = chai.expect;
var assert = chai.assert;
var TRIGGER1 = 'Trigger1';
var TRIGGER2 = 'Trigger2';
var TEST_SUBSCRIPTION = 'testSubscription';
var NOT_A_TRIGGER = 'NotATrigger';
var FILTER1 = 'Filter1';
var schema = new graphql_1.GraphQLSchema({
    query: new graphql_1.GraphQLObjectType({
        name: 'Query',
        fields: {
            testString: {
                type: graphql_1.GraphQLString,
                resolve: function (_, args) {
                    return 'works';
                },
            },
        },
    }),
    subscription: new graphql_1.GraphQLObjectType({
        name: 'Subscription',
        fields: {
            testSubscription: {
                type: graphql_1.GraphQLString,
                resolve: function (root) {
                    return root;
                },
            },
            testFilter: {
                type: graphql_1.GraphQLString,
                resolve: function (root, _a) {
                    var filterBoolean = _a.filterBoolean;
                    return filterBoolean ? 'goodFilter' : 'badFilter';
                },
                args: {
                    filterBoolean: { type: graphql_1.GraphQLBoolean },
                },
            },
            testFilterMulti: {
                type: graphql_1.GraphQLString,
                resolve: function (root, _a) {
                    var filterBoolean = _a.filterBoolean;
                    return filterBoolean ? 'goodFilter' : 'badFilter';
                },
                args: {
                    filterBoolean: { type: graphql_1.GraphQLBoolean },
                    a: { type: graphql_1.GraphQLString },
                    b: { type: graphql_1.GraphQLInt },
                },
            },
            testChannelOptions: {
                type: graphql_1.GraphQLString,
                resolve: function (root) {
                    return root;
                },
                args: {
                    repoName: { type: graphql_1.GraphQLString },
                },
            },
        },
    }),
});
describe('SubscriptionManager', function () {
    this.timeout(30000);
    var subManager = new graphql_subscriptions_1.SubscriptionManager({
        schema: schema,
        setupFunctions: {
            'testFilter': function (options, _a) {
                var filterBoolean = _a.filterBoolean;
                return {
                    'Filter1': { filter: function (root) { return root.filterBoolean === filterBoolean; } },
                };
            },
            'testFilterMulti': function (options) {
                return {
                    'Trigger1': { filter: function () { return true; } },
                    'Trigger2': { filter: function () { return true; } },
                };
            },
        },
        pubsub: new amqp_pubsub_1.AmqpPubSub({ logger: logger }),
    });
    it('throws an error if query is not valid', function () {
        var query = 'query a{ testInt }';
        var callback = function () { return null; };
        return expect(subManager.subscribe({ query: query, operationName: 'a', callback: callback }))
            .to.eventually.be.rejectedWith('Subscription query has validation errors');
    });
    it('rejects subscriptions with more than one root field', function () {
        var query = 'subscription X{ a: testSubscription, b: testSubscription }';
        var callback = function () { return null; };
        return expect(subManager.subscribe({ query: query, operationName: 'X', callback: callback }))
            .to.eventually.be.rejectedWith('Subscription query has validation errors');
    });
    it('can subscribe with a valid query and get the root value', function (done) {
        var query = 'subscription X{ testSubscription }';
        var subscriberId;
        var callback = function (err, payload) {
            try {
                expect(payload.data.testSubscription).to.equals('good');
                setTimeout(function () { return done(); }, 2);
            }
            catch (e) {
                setTimeout(function () { return done(e); }, 2);
                return;
            }
            finally {
                subManager.unsubscribe(subscriberId);
            }
        };
        subManager.subscribe({ query: query, operationName: 'X', callback: callback }).then(function (subId) {
            subscriberId = subId;
            subManager.publish('testSubscription', 'good');
        });
    });
    it('can use filter functions properly', function (done) {
        var query = "subscription Filter1($filterBoolean: Boolean){\n     testFilter(filterBoolean: $filterBoolean)\n   }";
        var subscriberId;
        var callback = function (err, payload) {
            try {
                expect(payload.data.testFilter).to.equals('goodFilter');
                setTimeout(function () { return done(); }, 2);
            }
            catch (e) {
                setTimeout(function () { return done(e); }, 2);
                return;
            }
            finally {
                subManager.unsubscribe(subscriberId);
            }
        };
        subManager.subscribe({
            query: query,
            operationName: 'Filter1',
            variables: { filterBoolean: true },
            callback: callback,
        }).then(function (subId) {
            subscriberId = subId;
            subManager.publish(FILTER1, { filterBoolean: false });
            subManager.publish(FILTER1, { filterBoolean: true });
        });
    });
    it('can subscribe to more than one trigger', function (done) {
        var triggerCount = 0;
        var query = "subscription multiTrigger($filterBoolean: Boolean, $uga: String){\n      testFilterMulti(filterBoolean: $filterBoolean, a: $uga, b: 66)\n    }";
        var subscriberId;
        var callback = function (err, payload) {
            try {
                expect(payload.data.testFilterMulti).to.equals('goodFilter');
                triggerCount++;
                logger.debug('Checking the callback ', err, payload, triggerCount);
            }
            catch (e) {
                setTimeout(function () { return done(e); }, 2);
                subManager.unsubscribe(subscriberId);
                return;
            }
            if (triggerCount === 2) {
                subManager.unsubscribe(subscriberId);
                setTimeout(function () { return done(); }, 2);
            }
        };
        subManager.subscribe({
            query: query,
            operationName: 'multiTrigger',
            variables: { filterBoolean: true, uga: 'UGA' },
            callback: callback,
        }).then(function (subId) {
            subscriberId = subId;
            subManager.publish(NOT_A_TRIGGER, { filterBoolean: false });
            subManager.publish(TRIGGER1, { filterBoolean: true });
            subManager.publish(TRIGGER2, { filterBoolean: true });
        });
    });
    it('can unsubscribe', function (done) {
        var query = 'subscription X{ testSubscription }';
        var callback = function (err, payload) {
            logger.debug('callback would not be called but called with ', payload, err);
            try {
                assert(false);
            }
            catch (e) {
                done(e);
                return;
            }
            done();
        };
        subManager.subscribe({ query: query, operationName: 'X', callback: callback }).then(function (subId) {
            subManager.unsubscribe(subId);
            subManager.publish('testSubscription', 'bad');
            setTimeout(done, 100);
        });
    });
    it('throws an error when trying to unsubscribe from unknown id', function () {
        expect(function () { return subManager.unsubscribe(123); })
            .to.throw('undefined');
    });
    it('calls the error callback if there is an execution error', function (done) {
        var query = "subscription X($uga: Boolean!){\n      testSubscription @skip(if: $uga)\n    }";
        var subscriberId;
        var callback = function (err, payload) {
            try {
                expect(payload.errors[0].message).to.equals('Variable "$uga" of required type "Boolean!" was not provided.');
                setTimeout(function () { return done(); }, 2);
            }
            catch (e) {
                setTimeout(function () { return done(e); }, 2);
            }
            finally {
                subManager.unsubscribe(subscriberId);
            }
        };
        subManager.subscribe({ query: query, operationName: 'X', callback: callback }).then(function (subId) {
            subscriberId = subId;
            subManager.publish('testSubscription', 'good');
        });
    });
    it('can use transform function to convert the trigger name given into more explicit channel name', function (done) {
        var triggerTransform = function (trigger, _a) {
            var path = _a.path;
            return [trigger].concat(path).join('.');
        };
        var pubsub = new amqp_pubsub_1.AmqpPubSub({
            logger: logger,
            triggerTransform: triggerTransform,
        });
        var subscriberId;
        var subManager2 = new graphql_subscriptions_1.SubscriptionManager({
            schema: schema,
            setupFunctions: {
                testChannelOptions: function (options, _a) {
                    var repoName = _a.repoName;
                    return ({
                        comments: {
                            channelOptions: { path: [repoName] },
                        },
                    });
                },
            },
            pubsub: pubsub,
        });
        var callback = function (err, payload) {
            try {
                expect(payload.data.testChannelOptions).to.equals('test');
                setTimeout(function () { return done(); }, 2);
            }
            catch (e) {
                setTimeout(function () { return done(e); }, 2);
            }
            finally {
                pubsub.unsubscribe(subscriberId);
            }
        };
        var query = "\n      subscription X($repoName: String!) {\n        testChannelOptions(repoName: $repoName)\n      }";
        var variables = { repoName: 'graphql-rabbitmq-subscriptions' };
        subManager2.subscribe({ query: query, operationName: 'X', variables: variables, callback: callback }).then(function (subId) {
            subscriberId = subId;
            pubsub.publish('comments.graphql-rabbitmq-subscriptions', 'test');
        });
    });
});
describe('Delete Queues After tests', function () {
    it('Delete all test queues', function () {
        var config = { host: '127.0.0.1', port: 5672 };
        var f = new rabbitmq_pub_sub_1.RabbitMqConnectionFactory(logger, config);
        return f.create().then(function (c) {
            return c.createChannel().then(function (ch) {
                return Promise.all([ch.deleteExchange(TEST_SUBSCRIPTION + ".DLQ.Exchange"),
                    ch.deleteExchange("comments.graphql-rabbitmq-subscriptions.DLQ.Exchange"),
                    ch.deleteExchange(TRIGGER1 + ".DLQ.Exchange"),
                    ch.deleteExchange(TRIGGER2 + ".DLQ.Exchange"),
                    ch.deleteExchange(NOT_A_TRIGGER + ".DLQ.Exchange"),
                    ch.deleteExchange(FILTER1 + ".DLQ.Exchange"),
                ]);
            });
        });
    });
});
//# sourceMappingURL=integration-tests.js.map