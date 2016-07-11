import Disposable from 'disposable';
import ko from 'knockout';
import { formatSize } from 'utils';

export default class PoolRowViewModel extends Disposable {
    constructor(pool, tier) {
        super();

        this.selected = ko.observable(
            tier.node_pools.indexOf(pool.name) > -1
        );
        this.icon = 'pool';
        this.name = pool.name;
        this.onlineNodeCount = pool.nodes.online;
        this.freeSpace = formatSize(pool.storage.free);
    }
}
