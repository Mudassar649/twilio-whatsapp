const express = require('express');
const mongoose = require('mongoose');
const cron = require('node-cron');
const route = express.Router();
const { sendWhatsAppMessage } = require('./twillio-whatsapp');
const { formatWhatsAppNumber, normalizePhoneNumber, parseResponse  } = require('./utils')


const fridayNotification = new mongoose.Schema({
    phoneNumber: { type: String, required: true, unique: true },
  state: {
        type: String,
        enum: [
            'INITIAL_SENT', 'INITIAL_NO_RESPONSE', 'ROUND_1_SENT', 'ROUND_1_COMPLETE',
            'TRANSITION_SENT', 'TRANSITION_NO_RESPONSE', 'ROUND_2_SENT', 'ROUND_2_COMPLETE', 
            'COMPLETED', 'ABANDONED'
        ],
        default: 'INITIAL_SENT'
    },
    currentWeek: { type: Date, default: Date.now },
    lastMessageSent: { type: Date, default: Date.now },
    reminderCount: { type: Number, default: 0 },
    responses: {
        round1: {
            scaleUpdate: Number,
            sweatSessions: Number,
            cardioMinutes: Number,
            walkInOut: Number,
            foodGame: String
        },
        round2: {
            H2Ohero: Number,
            sleepScore: Number,
            confidenceBoost: String,
            stressCheck: Number,
            liquidIntake: Number
        }
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const FridayNotification = mongoose.model('FridayNotification', fridayNotification);

// Messages
const MESSAGES = {
    INITIAL: `🗓️ Friday Check-in Time! Your AI coach needs the weekly intel to keep you on the path to legendary status. 2 minutes, tops - shorter than your bathroom break! Ready? Reply (Y/N)`,
    FIRST_NO_MSG: `No worries, we get it - life happens! We'll ping you in a few hours. Your progress won't judge you... much 😏`,
    ROUND_1: `Round 1: Progess Check
    1. Scale update - What's your current weight? (No hiding from the truth, bro!)
    2. Sweat sessions - How many days did you exercise this week? (0-7)
    3. Cardio minutes - Average daily cardio minutes? (Every step counts!)
    4. Walk it out - Average daily walking minutes? (Chasing kids counts!)
    5. Food game - Did you make any food changes this week? (Y/N)
    Please respond with all 5 answers separated by commas.
    *Example:* 23, 7, 10, 5, Y 
    `,
    LAST_NOTE: `Using last week's data - we know you're still crushing it!`,
    TRANSITION_MSG: `Solid work! 💪 Got bandwidth for 5 more questions? These help fine-tune your program like a sports car. Reply(Y/N)`,
    SECOND_NO_MSG: `Totally cool! We'll catch you later. Even Superman needs a break 🦸‍♂️`,
    ROUND_2: `Round 2: Lifestyle check
    1. H2O hero - Average glasses of water daily this week? (0-10) Your body will thank you!,
    2. Sleep score - How was your sleep game? (5 = hibernating bear, 0 = vampire schedule)
    3. Confidence boost - Notice any improvements in your bedroom confidence?
    4. Stress check - Weekly stress level? (5 = Mount Vesuvius, 0 = beach vacation vibes)
    5. Liquid intake - Average alcoholic drinks per day? (0-8) Honesty is the best policy!
    `,
    COMPLETION_MSG: `🏆 Check-in complete! Your Dadbod AI coach is analyzing the data and plotting your next level-up. Keep being awesome - your future self is already thanking you!`
}

function validateRound1Response(responses) {
    if (responses.length !== 5) return false;
    
    const [weight, sessions, cardio, walking, foodChanges] = responses;
    
    return !isNaN(weight) && weight > 0 && weight < 1000 &&
           !isNaN(sessions) && sessions >= 0 && sessions <= 7 &&
           !isNaN(cardio) && cardio >= 0 && cardio <= 300 &&
           !isNaN(walking) && walking >= 0 && walking <= 300 &&
           ['Y', 'N'].includes(foodChanges);
}

function validateRound2Response(responses) {
    if (responses.length !== 5) return false;
    
    const [water, sleep, confidence, stress, drinks] = responses;
    
    return !isNaN(water) && water >= 0 && water <= 10 &&
           !isNaN(sleep) && sleep >= 0 && sleep <= 5 &&
           ['Y', 'N'].includes(confidence) &&
           !isNaN(stress) && stress >= 0 && stress <= 5 &&
           !isNaN(drinks) && drinks >= 0 && drinks <= 8;
}

// Get all completed onboarding users for Friday notifications
async function getEligibleUsers() {
    try {
        // Import User model from main app
        const User = mongoose.model('User');
        const eligibleUsers = await User.find({ 
            state: 'ONBOARDING_COMPLETE' 
        }).select('phoneNumber');
        
        return eligibleUsers.map(user => user.phoneNumber);
    } catch (error) {
        console.error('Error fetching eligible users:', error);
        return [];
    }
}

// Initialize Friday notifications for all eligible users
async function initializeFridayNotifications() {
    console.log('Initializing Friday notifications...');
    const eligiblePhones = await getEligibleUsers();
    
    for (const phoneNumber of eligiblePhones) {
        try {
            // Check if user already has a notification for this week
            const startOfWeek = new Date();
            startOfWeek.setHours(0, 0, 0, 0);
            startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); // Start of week (Sunday)
            
            let notification = await FridayNotification.findOne({
                phoneNumber,
                currentWeek: { $gte: startOfWeek }
            });
            
            if (!notification) {
                notification = new FridayNotification({
                    phoneNumber,
                    state: 'INITIAL_SENT',
                    currentWeek: new Date(),
                    lastMessageSent: new Date(),
                    reminderCount: 0
                });
                await notification.save();
            }
            
            // Send initial message
            await sendWhatsAppMessage(phoneNumber, MESSAGES.INITIAL);
            console.log(`Friday notification sent to ${phoneNumber}`);
            
        } catch (error) {
            console.error(`Error initializing notification for ${phoneNumber}:`, error);
        }
    }
}

// Handle reminder logic for non-responsive users
async function sendReminders() {
    console.log('Checking for reminder notifications...');
    const now = new Date();
    const threeHoursAgo = new Date(now.getTime() - (3 * 60 * 60 * 1000));
    
    // Find users who need reminders
    const usersNeedingReminders = await FridayNotification.find({
        $or: [
            { state: 'INITIAL_SENT' },
            { state: 'INITIAL_NO_RESPONSE' },
            { state: 'TRANSITION_SENT' },
            { state: 'TRANSITION_NO_RESPONSE' }
        ],
        lastMessageSent: { $lte: threeHoursAgo },
        reminderCount: { $lt: 2 }
    });
    
    for (const notification of usersNeedingReminders) {
        try {
            let messageToSend = '';
            let newState = '';
            
            if (notification.state === 'INITIAL_SENT' || notification.state === 'INITIAL_NO_RESPONSE') {
                messageToSend = MESSAGES.FIRST_NO_MSG;
                newState = 'INITIAL_NO_RESPONSE';
            } else if (notification.state === 'TRANSITION_SENT' || notification.state === 'TRANSITION_NO_RESPONSE') {
                messageToSend = MESSAGES.SECOND_NO_MSG;
                newState = 'TRANSITION_NO_RESPONSE';
            }
            
            await sendWhatsAppMessage(notification.phoneNumber, messageToSend);
            
            notification.reminderCount += 1;
            notification.lastMessageSent = new Date();
            notification.state = newState;
            notification.updatedAt = new Date();
            await notification.save();
            
        } catch (error) {
            console.error(`Error sending reminder to ${notification.phoneNumber}:`, error);
        }
    }
}

// Send Saturday final messages
async function sendSaturdayFinalMessages() {
    console.log('Sending Saturday final messages...');
    
    // Find users who haven't responded after all reminders
    const unresponsiveUsers = await FridayNotification.find({
        $or: [
            { state: 'INITIAL_NO_RESPONSE', reminderCount: 2 },
            { state: 'TRANSITION_NO_RESPONSE', reminderCount: 2 }
        ]
    });
    
    for (const notification of unresponsiveUsers) {
        try {
            let messageToSend = '';
            let newState = '';
            
            if (notification.state === 'INITIAL_NO_RESPONSE') {
                messageToSend = MESSAGES.LAST_NOTE;
                newState = 'ABANDONED';
            } else if (notification.state === 'TRANSITION_NO_RESPONSE') {
                // For round 2 transition no response, send completion message
                messageToSend = MESSAGES.COMPLETION_MSG;
                newState = 'COMPLETED';
            }
            
            await sendWhatsAppMessage(notification.phoneNumber, messageToSend);
            
            notification.state = newState;
            notification.updatedAt = new Date();
            await notification.save();
            
        } catch (error) {
            console.error(`Error sending Saturday message to ${notification.phoneNumber}:`, error);
        }
    }
}

// Handle webhook responses for Friday notifications
async function handleFridayResponse(phoneNumber, response) {
    console.log(`Handling Friday response from ${phoneNumber}: ${response}`);
    
    let notification = await FridayNotification.findOne({ phoneNumber });
    
    if (!notification) {
        console.log(`No Friday notification found for ${phoneNumber}`);
        return false; // Let main webhook handler deal with it
    }
    
    const normalizedResponse = response.trim().toUpperCase();
    
    switch (notification.state) {
        case 'INITIAL_SENT':
        case 'INITIAL_NO_RESPONSE':
            return await handleInitialResponse(notification, normalizedResponse, phoneNumber);
            
        case 'ROUND_1_SENT':
            return await handleRound1Response(notification, response, phoneNumber);
            
        case 'ROUND_1_COMPLETE':
        case 'TRANSITION_SENT':
        case 'TRANSITION_NO_RESPONSE':
            return await handleTransitionResponse(notification, normalizedResponse, phoneNumber);
            
        case 'ROUND_2_SENT':
            return await handleRound2Response(notification, response, phoneNumber);
            
        default:
            return false; // Not a Friday notification response
    }
}

async function handleInitialResponse(notification, response, phoneNumber) {
    const answer = parseResponse(response, 'YN');
    
    if (answer === 'Y') {
        await sendWhatsAppMessage(phoneNumber, MESSAGES.ROUND_1);
        notification.state = 'ROUND_1_SENT';
        notification.reminderCount = 0;
    } else if (answer === 'N') {
        await sendWhatsAppMessage(phoneNumber, MESSAGES.FIRST_NO_MSG);
        notification.state = 'INITIAL_NO_RESPONSE';
        notification.reminderCount = 1;
    } else {
        await sendWhatsAppMessage(phoneNumber, "Please reply with *Y* to continue or *N* to skip. 🤔");
        return true;
    }
    
    notification.lastMessageSent = new Date();
    notification.updatedAt = new Date();
    await notification.save();
    return true;
}

async function handleRound1Response(notification, response, phoneNumber) {
    const responses = parseResponse(response, 'COMMA_SEPARATED');
    
    if (!validateRound1Response(responses)) {
        await sendWhatsAppMessage(phoneNumber, "⚠️ Please check the format and try again. Example: 175, 4, 30, 45, Y");
        return true;
    }
    
    // Save responses
    notification.responses.round1 = {
        scaleUpdate: parseInt(responses[0]),
        sweatSessions: parseInt(responses[1]),
        cardioMinutes: parseInt(responses[2]),
        walkInOut: parseInt(responses[3]),
        foodGame: responses[4]
    };
    
    notification.state = 'ROUND_1_COMPLETE';
    notification.updatedAt = new Date();
    await notification.save();
    
    // Send transition message
    await sendWhatsAppMessage(phoneNumber, MESSAGES.TRANSITION_MSG);
    notification.state = 'TRANSITION_SENT';
    notification.lastMessageSent = new Date();
    notification.reminderCount = 0;
    await notification.save();
    
    return true;
}

async function handleTransitionResponse(notification, response, phoneNumber) {
    const answer = parseResponse(response, 'YN');
    
    if (answer === 'Y') {
        await sendWhatsAppMessage(phoneNumber, MESSAGES.ROUND_2);
        notification.state = 'ROUND_2_SENT';
        notification.reminderCount = 0;
    } else if (answer === 'N') {
        await sendWhatsAppMessage(phoneNumber, MESSAGES.SECOND_NO_MSG);
        notification.state = 'TRANSITION_NO_RESPONSE';
        notification.reminderCount = 1;
    } else {
        await sendWhatsAppMessage(phoneNumber, "Please reply with *Y* to continue or *N* to finish. 🤔");
        return true;
    }
    
    notification.lastMessageSent = new Date();
    notification.updatedAt = new Date();
    await notification.save();
    return true;
}

async function handleRound2Response(notification, response, phoneNumber) {
    const responses = parseResponse(response, 'COMMA_SEPARATED');
    
    if (!validateRound2Response(responses)) {
        await sendWhatsAppMessage(phoneNumber, "⚠️ Please check the format and try again. Example: 8, 3, Y, 2, 1");
        return true;
    }
    
    // Save responses
    notification.responses.round2 = {
        H2Ohero: parseInt(responses[0]),
        sleepScore: parseInt(responses[1]),
        confidenceBoost: responses[2],
        stressCheck: parseInt(responses[3]),
        liquidIntake: parseInt(responses[4])
    };
    
    notification.state = 'COMPLETED';
    notification.updatedAt = new Date();
    await notification.save();
    
    // Send completion message
    
    return true;
}

// Cron jobs
// Send Friday notifications at 9:00 AM every Friday
cron.schedule('0 9 * * 5', () => {
    console.log('Running Friday notification job...');
    initializeFridayNotifications();
}, {
    scheduled: true,
    timezone: "America/New_York" // Adjust to your timezone
});

// Send reminders every 3 hours (only on Friday and Saturday)
cron.schedule('0 */3 * * 5,6', () => {
    console.log('Running reminder check...');
    sendReminders();
}, {
    scheduled: true,
    timezone: "America/New_York"
});

// Send final messages on Saturday at 10:00 AM
cron.schedule('0 10 * * 6', () => {
    console.log('Running Saturday final message job...');
    sendSaturdayFinalMessages();
}, {
    scheduled: true,
    timezone: "America/New_York"
});

// API endpoints
route.get('/friday-notifications', async (req, res) => {
    try {
        const notifications = await FridayNotification.find({}).sort({ createdAt: -1 });
        res.json(notifications);
    } catch (error) {
        console.error('Error fetching Friday notifications:', error);
        res.status(500).json({ error: error.message });
    }
});

route.get('/friday-notifications/:phoneNumber', async (req, res) => {
    try {
        const phoneNumber = normalizePhoneNumber(req.params.phoneNumber);
        const notification = await FridayNotification.findOne({ phoneNumber });
        
        if (!notification) {
            return res.status(404).json({ error: 'Friday notification not found' });
        }
        
        res.json(notification);
    } catch (error) {
        console.error('Error fetching Friday notification:', error);
        res.status(500).json({ error: error.message });
    }
});

// Manual trigger for testing
route.post('/trigger-friday-notifications', async (req, res) => {
    try {
        await initializeFridayNotifications();
        res.json({ success: true, message: 'Friday notifications triggered' });
    } catch (error) {
        console.error('Error triggering Friday notifications:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

route.post('/trigger-reminders', async (req, res) => {
    try {
        await sendReminders();
        res.json({ success: true, message: 'Reminders sent' });
    } catch (error) {
        console.error('Error sending reminders:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

route.post('/trigger-saturday-messages', async (req, res) => {
    try {
        await sendSaturdayFinalMessages();
        res.json({ success: true, message: 'Saturday messages sent' });
    } catch (error) {
        console.error('Error sending Saturday messages:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = route