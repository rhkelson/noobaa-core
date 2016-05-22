/**
 *
 * REDIRECTOR
 *
 */
'use strict';

const _ = require('lodash');
const util = require('util');
const server_rpc = require('../server_rpc');
var cutil = require('../utils/clustering_utils');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);

// dbg.set_level(5);

const agents_address_map = new Map();
const cluster_connections = new Set();


/*
 * REDIRECTOR API
 */
function redirect(req) {
    var scatter_redirect =
        _.isUndefined(req.rpc_params.stop_redirect) ? false : req.rpc_params.stop_redirect;
    dbg.log2('redirect request for', req.rpc_params, 'scatter redirect', scatter_redirect);

    //Remove the leading n2n:// prefix from the address
    var target_agent = req.rpc_params.target.slice(6);
    var address = agents_address_map.get(target_agent);
    if (address) {
        dbg.log3('redirect found entry', address);
        return P.when(server_rpc.client.node.redirect(req.rpc_params, {
                address: address,
            }))
            .then(function(res) {
                if (scatter_redirect) {
                    return {
                        redirect_reply: {
                            scatter_res: res,
                        }
                    };
                } else {
                    return res;
                }
            });
    } else {
        //If part of a cluster, & not already a scatter redirect
        //try to scattershot ther other redirectors
        if (!cutil.is_single_server() && !scatter_redirect) {
            dbg.log3('Local agent was not found, scatter redirecting');
            req.rpc_params.stop_redirect = true;
            //TODO:: Don't call myself
            return P.all(_.map(cutil.get_all_cluster_members(), function(srv) {
                    dbg.log4('scatter redirect calling', 'ws://' + srv + ':8081');
                    return P.when(server_rpc.client.redirector.redirect(req.rpc_params, {
                            //TODO:: port and ws/wss decision
                            address: 'ws://' + srv + ':8081',
                        }))
                        .fail(function(err) {
                            dbg.log0('Failed scatter redirect on', srv, 'with err', err);
                            return;
                        });
                }))
                .then(function(res) {
                    var reply = {};
                    _.each(res, function(r) {
                        if (r.redirect_reply && r.redirect_reply.scatter_res) {
                            reply = r.redirect_reply.scatter_res;
                            dbg.log3('Got back scatter response', reply);
                        }
                    });
                    return reply;
                });
        }
        //stop redirect is recieved from another redirector, in such a case, don't throw
        if (scatter_redirect) {
            return {};
        } else {
            throw new Error('Agent not registered with ' + address + 'target:' + target_agent);
        }
    }
}

function register_agent(req) {
    dbg.log2('Registering agent', req.rpc_params.peer_id, 'with server', req.connection.url.href);

    var agent = req.rpc_params.peer_id;
    var address = agents_address_map.get(agent);
    if (address) {
        // Update data
        agents_address_map.set(agent, req.connection.url.href);
    } else {
        add_agent_to_connection(req.connection, agent);
    }
    return;
}

function unregister_agent(req) {
    dbg.log2('Un-registering agent', req.rpc_params.peer_id, 'with server', req.connection.url);

    var agent = req.rpc_params.peer_id;
    remove_agent_from_connection(req.connection, agent);
}

function resync_agents(req) {
    dbg.log0('resync_agents of #', req.rpc_params.agents.length,
        'agents with server', req.connection.url.href,
        'request timestamp', req.rpc_params.timestamp,
        'last_resync', req.connection.last_resync);

    if (req.connection.last_resync &&
        req.connection.last_resync >= req.rpc_params.timestamp) {
        dbg.warn('resync_agents recived old sync request, ignoring');
        return;
    }

    cleanup_on_close(req.connection);
    req.connection.last_resync = req.rpc_params.timestamp;
    _.each(req.rpc_params.agents, function(agent) {
        add_agent_to_connection(req.connection, agent);
    });
}

function print_registered_agents(req) {
    dbg.log0('Registered Agents:', util.inspect(agents_address_map, false, null));
    return agents_address_map.size + ' Registered Agents printed';
}

function cleanup_on_close(connection) {
    if (connection.agents) {
        dbg.log0('cleanup_on_close', connection.url.href,
            '#', connection.agents.size, 'agents');
        connection.agents.forEach(function(agent) {
            remove_agent_from_connection(connection, agent);
        });
        if (connection.agents.size) {
            dbg.warn('cleanup_on_close dangling agents in connection', connection.url.href,
                '#', connection.agents.size, 'agents');
        }
    }
}

function add_agent_to_connection(connection, agent) {
    agents_address_map.set(agent, connection.url.href);

    //Save agent on connection for quick cleanup on close,
    //Register on close handler to clean the agents form the agents2srvs map
    if (!connection.agents) {
        connection.agents = new Set();
        connection.on('close', function() {
            cleanup_on_close(connection);
        });
    }
    connection.agents.add(agent);
}

function remove_agent_from_connection(connection, agent) {
    var address = agents_address_map.get(agent);
    if (address) {
        if (connection.url.href === address) {
            //Remove agent
            agents_address_map.delete(agent);
        } else {
            dbg.warn('hmmm, recieved unregister for', agent, 'on connection to', connection.url.href,
                'while previously registered on', address, ', ignoring');
        }
    }
    if (!connection.agents || !connection.agents.delete(agent)) {
        dbg.warn('hmmm, recieved unregister for', agent, 'on connection to', connection.url.href,
            'while the agent was not registered on this connection');
    }
}


function register_to_cluster(req) {
    var conn = req.connection;
    if (!cluster_connections.has(conn)) {
        dbg.log0('register_to_cluster', conn.url.href);
        cluster_connections.add(conn);
        conn.on('close', function() {
            cluster_connections.delete(conn);
        });
    }
}

function publish_to_cluster(req) {
    var api_name = req.rpc_params.method_api.slice(0, -4); // remove _api suffix
    var method = req.rpc_params.method_name;
    var addresses = ['fcall://fcall']; // also call on myself
    cluster_connections.forEach(function(conn) {
        addresses.push(conn.url.href);
    });
    addresses = _.uniq(addresses);
    dbg.log0('publish_to_cluster:', addresses);
    return P.map(addresses, function(address) {
            return server_rpc.client[api_name][method](req.rpc_params.request_params, {
                address: address,
                auth_token: req.auth_token,
            });
        })
        .then(function(res) {
            return {
                redirect_reply: {
                    aggregated: res,
                }
            };
        });
}


// EXPORTS
exports.redirect = redirect;
exports.register_agent = register_agent;
exports.unregister_agent = unregister_agent;
exports.resync_agents = resync_agents;
exports.print_registered_agents = print_registered_agents;
exports.register_to_cluster = register_to_cluster;
exports.publish_to_cluster = publish_to_cluster;
