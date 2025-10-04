import redisClient from '../redis-client';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] [PAYMENT-SERVICE] ${level.toUpperCase()}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        }),
        new winston.transports.File({ filename: 'logs/payment-service.log' })
    ]
});

(async function consumeInventory() {
    let lastId = '0-0';
    logger.info('Payment Service started - listening for InventoryReserved events');

    while (true) {
        try {
            const messages = await redisClient.xRead(
                [{ key: 'inventory', id: lastId }],
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
                    const { type, orderId } = message.message as any;

                    if (type === 'InventoryReserved') {
                        logger.info(`Processing payment for order: ${orderId}`);

                        // Simulate payment processing (70% success rate)
                        const success = Math.random() > 0.3;
                        const eventType = success ? 'PaymentCompleted' : 'PaymentFailed';

                        await redisClient.xAdd('payments', '*', {
                            type: eventType,
                            orderId
                        });

                        await redisClient.xAdd('order_updates', '*', {
                            orderId,
                            status: success ? 'PAYMENT_COMPLETED' : 'PAYMENT_FAILED'
                        });

                        if (success) {
                            logger.info(`✓ Payment completed for order: ${orderId}`);
                        } else {
                            logger.warn(`✗ Payment failed for order: ${orderId}`);
                        }
                    }
                }
            }
        } catch (error) {
            logger.error(`Error processing payments: ${error}`);
        }
    }
})();