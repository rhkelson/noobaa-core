'use strict';

const fs = require('fs');
const P = require('../../util/promise');
const os_utils = require('../../util/os_utils');
const fs_utils = require('../../util/fs_utils');
const promise_utils = require('../../util/promise_utils');
const base_diagnostics = require('../../util/base_diagnostics');
const stats_aggregator = require('../system_services/stats_aggregator');
const system_store = require('../system_services/system_store').get_instance();

const TMP_WORK_DIR = '/tmp/diag';


//TODO: Add temp collection dir as param
function collect_server_diagnostics(req) {
    return P.fcall(function() {
            let limit_logs_size = false;
            let local_cluster = system_store.get_local_cluster_info();
            return base_diagnostics.collect_basic_diagnostics(limit_logs_size, local_cluster && local_cluster.is_clusterized);
        })
        .then(function() {

            // operations for diagnostics that can take place in parallel
            const operations = [
                () => collect_supervisor_logs(),
                () => promise_utils.exec('cp -f /var/log/noobaa_deploy* ' + TMP_WORK_DIR, true),
                () => promise_utils.exec('cp -f /var/log/noobaa.log* ' + TMP_WORK_DIR, true),
                () => promise_utils.exec('cp -f ' + process.cwd() + '/.env ' + TMP_WORK_DIR + '/env', true),
                () => os_utils.top_single(TMP_WORK_DIR + '/top.out'),
                () => promise_utils.exec('cp -f /etc/noobaa* ' + TMP_WORK_DIR, true),
                () => promise_utils.exec('lsof &> ' + TMP_WORK_DIR + '/lsof.out', true),
                () => promise_utils.exec('chkconfig &> ' + TMP_WORK_DIR + '/chkconfig.out', true),
                () => collect_ntp_diagnostics(),
                () => collect_statistics.bind(this, req)
            ];


            return P.map(operations, op => op(), {
                    concurrency: 10
                })
                .then(null, function(err) {
                    console.error('Error in collecting server diagnostics (should never happen)', err);
                    throw new Error('Error in collecting server diagnostics ' + err);
                });
        });
}

function pack_diagnostics(dst) {
    return base_diagnostics.pack_diagnostics(dst);
}

function write_agent_diag_file(data) {
    return base_diagnostics.write_agent_diag_file(data);
}

function collect_ntp_diagnostics() {
    let ntp_diag = TMP_WORK_DIR + '/ntp.diag';
    return promise_utils.exec('echo "### NTP diagnostics ###" >' + ntp_diag, true)
        .then(() => promise_utils.exec('echo "\ncontent of /etc/ntp.conf:" &>>' + ntp_diag, true))
        .then(() => promise_utils.exec('cat /etc/ntp.conf &>>' + ntp_diag, true))
        .then(() => promise_utils.exec('echo "\n\n" &>>' + ntp_diag, true))
        .then(() => promise_utils.exec('ls -l /etc/localtime &>>' + ntp_diag, true))
        .then(() => promise_utils.exec('echo "\n\nntpstat:" &>>' + ntp_diag, true))
        .then(() => promise_utils.exec('ntpstat &>>' + ntp_diag, true))
        .then(() => promise_utils.exec('echo "\n\ndate:" &>>' + ntp_diag, true))
        .then(() => promise_utils.exec('date &>>' + ntp_diag, true))
        .then(() => promise_utils.exec('echo "\n\nntpdate:" &>>' + ntp_diag, true))
        .then(() => promise_utils.exec('ntpdate &>>' + ntp_diag, true))
        .then(() => promise_utils.exec('echo "\n\nntptime:" &>>' + ntp_diag, true))
        .then(() => promise_utils.exec('ntptime &>>' + ntp_diag, true));
}

//Collect supervisor logs, only do so on linux platforms and not on OSX (WA for local server run)
function collect_supervisor_logs() {
    if (process.platform === 'linux') {
        return P.resolve()
            .then(() => fs_utils.full_dir_copy('/tmp/supervisor', TMP_WORK_DIR))
            .catch(function(err) {
                console.error('Error in collecting supervisor logs', err);
                throw new Error('Error in collecting supervisor logs ' + err);
            });
    } else {
        console.log('Skipping supervisor logs collection on non linux server');
    }
}

function collect_statistics(req) {
    return P.resolve().then(function() {
            let current_clustering = system_store.get_local_cluster_info();
            if (stats_aggregator && !((current_clustering && current_clustering.is_clusterized) && !system_store.is_cluster_master)) {
                return stats_aggregator.get_all_stats(req);
            } else {
                return;
            }
        })
        .catch(function(err) {
            console.error('Failed to collect stats', err.stack || err);
        })
        .then(function(restats) {
            if (stats_aggregator) {
                var stats_data = JSON.stringify(restats);
                return fs.writeFileAsync(TMP_WORK_DIR + '/phone_home_stats.out', stats_data);
            } else {
                return;
            }
        })
        .catch(function(err) {
            console.error('Failed to collect phone_home_stats', err.stack || err);
        });
}


// EXPORTS
exports.collect_server_diagnostics = collect_server_diagnostics;
exports.pack_diagnostics = pack_diagnostics;
exports.write_agent_diag_file = write_agent_diag_file;
