import redisClient from '../redis-client';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] [INVENTORY-SERVICE] ${level.toUpperCase()}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        }),
        new winston.transports.File({ filename: 'logs/inventory-service.log' })
    ]
});

const inventory: Record<string, number> = {
    item1: 10,
    item2: 5,
    item3: 8,
    item4: 0
};

logger.info('Initial inventory:', { inventory });

(async function consumeOrders() {
    let lastId = '0-0';
    logger.info('Inventory Service started - listening for OrderCreated events');

    while (true) {
        try {
            const messages = await redisClient.xRead(
                [{ key: 'orders', id: lastId }],
                { BLOCK: 0, COUNT: 10 }
            );

            if (!messages || !Array.isArray(messages)) continue;

            for (const stream of messages) {
                if (!stream || typeof stream !== 'object' || !('messages' in stream)) continue;
                if (!Array.isArray(stream.messages)) continue;

                for (const message of stream.messages) {
                    if (!message || typeof message !== 'object') continue;
                    if (!('id' in message) || typeof message.id !== 'string') continue;
                    if (!('message' in message) || typeof message.message !== 'object') continue;

                    lastId = message.id;
                    const { type, orderId, items } = message.message as any;

                    if (type === 'OrderCreated') {
                        logger.info(`Processing order: ${orderId}`);
                        const parsedItems: string[] = JSON.parse(items);
                        logger.info(`Items requested: ${parsedItems.join(', ')}`);

                        let available = parsedItems.every(
                            item => inventory[item] !== undefined && inventory[item] > 0
                        );

                        if (available) {
                            parsedItems.forEach(item => {
                                if (inventory[item] !== undefined) {
                                    inventory[item]--;
                                }
                            });

                            await redisClient.xAdd('inventory', '*', {
                                type: 'InventoryReserved',
                                orderId
                            });

                            await redisClient.xAdd('order_updates', '*', {
                                orderId,
                                status: 'INVENTORY_RESERVED'
                            });

                            logger.info(`Inventory reserved for order: ${orderId}`);
                            logger.info(`Updated inventory: ${JSON.stringify(inventory)}`);
                        } else {
                            await redisClient.xAdd('inventory', '*', {
                                type: 'InventoryFailed',
                                orderId
                            });

                            await redisClient.xAdd('order_updates', '*', {
                                orderId,
                                status: 'INVENTORY_FAILED'
                            });

                            logger.warn(`✗ Inventory failed for order: ${orderId} - Items not available`);
                        }
                    }
                }
            }
        } catch (error) {
            logger.error(`Error processing orders: ${error}`);
        }
    }
})();