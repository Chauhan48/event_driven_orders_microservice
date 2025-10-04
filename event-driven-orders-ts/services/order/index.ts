import express from 'express';
import redisClient from '../redis-client';
import winston from 'winston';

const app = express();
app.use(express.json());

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] [ORDER-SERVICE] ${level.toUpperCase()}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        }),
        new winston.transports.File({ filename: 'logs/order-service.log' })
    ]
});

const orders: Record<string, any> = {};

app.post('/orders', async (req, res) => {
    try {
        const { userId, items } = req.body;
        const orderId = `order_${Date.now()}`;

        const order = {
            orderId,
            userId,
            items,
            status: 'CREATED',
            createdAt: new Date().toISOString()
        };

        orders[orderId] = order;

        await redisClient.xAdd('orders', '*', {
            type: 'OrderCreated',
            orderId,
            items: JSON.stringify(items)
        });

        logger.info(`Order created: ${orderId} for user: ${userId}`);
        res.status(201).json(order);
    } catch (error) {
        logger.error(`Error creating order: ${error}`);
        res.status(500).json({ error: 'Failed to create order' });
    }
});

app.get('/orders/:orderId', (req, res) => {
    const { orderId } = req.params;
    const order = orders[orderId];

    if (!order) {
        logger.warn(`Order not found: ${orderId}`);
        return res.status(404).json({ error: 'Order not found' });
    }

    logger.info(`Order status retrieved: ${orderId} - Status: ${order.status}`);
    res.json(order);
});

(async function listenForUpdates() {
    let lastId = '0-0';

    while (true) {
        try {
            const messages = await redisClient.xRead(
                [{ key: 'order_updates', id: lastId }],
                { BLOCK: 5000, COUNT: 10 }
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
                    const { orderId, status } = message.message as any;

                    if (orders[orderId]) {
                        orders[orderId].status = status;
                        logger.info(`Order ${orderId} updated to status: ${status}`);
                    }
                }
            }
        } catch (error) {
            logger.error(`Error reading order updates: ${error}`);
        }
    }
})();

const PORT = 3001;
app.listen(PORT, () => {
    logger.info(`Order Service running on port ${PORT}`);
});