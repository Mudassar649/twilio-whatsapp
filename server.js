const express = require('express');
const twilio = require('twilio');
const mongoose = require('mongoose');
const app = express();
require('dotenv').config();

const { sendWhatsAppMessage } = require('./twillio-whatsapp');
const { normalizePhoneNumber, parseResponse } = require('./utils');

// Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const fridayNotification = require('./friday-notification-directory/friday-notification-routes');
const fridayNotificationController = require('./friday-notification-directory/friday-notification-controller')

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI);

// User Schema
const userSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true, unique: true },
  state: { 
    type: String, 
    enum: ['REGISTERED', 'ROUND_1_SENT', 'ROUND_1_COMPLETE', 'ROUND_2_SENT', 'ROUND_2_COMPLETE', 'ROUND_3_SENT', 'ONBOARDING_COMPLETE'],
    default: 'REGISTERED'
  },
  responses: {
    round1: {
      age: Number,
      weight: Number,
      targetWeightLoss: Number,
      alcoholDaysPerWeek: Number,
      exerciseDaysPerWeek: Number
    },
    round2: {
      waterGlasses: Number,
      sleepQuality: Number,
      improveIntimacy: String,
      stressLevel: Number,
      dailyDrinks: Number
    },
    round3: {
      highBloodPressure: String,
      type2Diabetes: String,
      cancer: String,
      osteoporosis: String,
      heartDisease: String,
      smoking: String,
      neckPain: String,
      hearingLoss: String,
      highCholesterol: String,
      anxiety: String,
      backPain: String,
      type1Diabetes: String,
      depression: String,
      osteoarthritis: String
    }
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Message templates
const MESSAGES = {
  INITIAL: `🎉 Welcome to the DadBod squad! Time to turn that "I'll start Monday" energy into actual results. Let's kick things off with 5 quick questions - no math required, we promise!`,
  ROUND_1: `*Round 1: Basic Info* 💪
    1. *Age check* - How old are you, champ? Just need the number, no fake IDs here 😄
    2. *Starting point* - What's your current weight? (No judgment zone - we've all been there)
    3. *The goal* - How many pounds are we looking to kiss goodbye?
    4. *Liquid courage meter* - How many days per week do you drink alcohol? (0-7)
    5. *Sweat equity* - How many days per week do you currently exercise? (0-7)
    Please respond with all 5 answers separated by commas.
    *Example:* 35, 180, 20, 2, 3`,
  TRANSITION_ROUND_2: `Great job! 💪 Ready for round 2? These questions help us fine-tune your plan. 
  Reply *Y* to continue or *N* to finish setup.`,
  ROUND_2: `*Round 2: Lifestyle Details* 🎯
    1. *Hydration station* - How many 8oz glasses of water do you drink daily? (0-10) 
      Pro tip: Beer doesn't count 🍺
    2. *Sleep game* - How's your sleep quality? (5 = sleeping like a baby, 0 = dad with a newborn)
    3. *Bedroom benefits* - Want to improve your game between the sheets? (Y/N)
    4. *Stress meter* - What's your weekly stress level? (5 = ready to flip tables, 0 = zen master)
    5. *Daily drinks* - On average, how many alcoholic drinks per day? (0-8)
    Please respond with all 5 answers separated by commas.
    *Example:* 6, 3, Y, 2, 1`,
  TRANSITION_ROUND_3: `Almost there! 🏁 One final round of quick Y/N health questions. 
  Reply *Y* to continue or *N* to finish setup.`,
  ROUND_3: `*Final Round: Health Check* 🏥
    Quick Y/N questions. Think of it like a health quiz, but way less boring than WebMD:
    1. High Blood Pressure (Y/N)
    2. Type 2 Diabetes (Y/N)
    3. Cancer (Y/N)
    4. Osteoporosis (Y/N)
    5. Heart Disease (Y/N)
    6. Smoking (Y/N)
    7. Neck pain (Y/N)
    8. Hearing loss (Y/N)
    9. High Cholesterol (Y/N)
    10. Anxiety (Y/N)
    11. Back pain (Y/N)
    12. Type 1 Diabetes (Y/N)
    13. Depression (Y/N)
    14. Osteoarthritis (Y/N)
    Please respond with 14 Y/N answers separated by commas.
    *Example:* N,N,N,Y,N,N,Y,N,N,Y,Y,N,N,N`,
  COMPLETION: `🎯 *You're officially locked and loaded!* 
    Your AI coach is building your personalized plan. Time to show that dad bod who's boss! 💪
    We'll be in touch soon with your custom fitness and nutrition strategy. Get ready to transform! 🔥`,  
  ERROR: `⚠️ Oops! That doesn't look right. Please check the format and try again. 
      Reply *HELP* if you need assistance.`,
  HELP: `*Need help?* Here's what I'm expecting:
    📋 *Round 1:* 5 numbers separated by commas
    📋 *Round 2:* 4 numbers and 1 Y/N, separated by commas  
    📋 *Round 3:* 14 Y/N answers separated by commas
    📋 *Transitions:* Just Y or N
    *Example formats:*
    • Round 1: 35, 180, 20, 2, 3
    • Round 2: 6, 3, Y, 2, 1
    • Round 3: N,N,N,Y,N,N,Y,N,N,Y,Y,N,N,N`
};

// Utility functions

function validateRound1Response(responses) {
  if (responses.length !== 5) return false;
  
  const [age, weight, targetLoss, alcoholDays, exerciseDays] = responses;
  
  return !isNaN(age) && age > 0 && age < 120 &&
         !isNaN(weight) && weight > 0 && weight < 1000 &&
         !isNaN(targetLoss) && targetLoss > 0 && targetLoss < 500 &&
         !isNaN(alcoholDays) && alcoholDays >= 0 && alcoholDays <= 7 &&
         !isNaN(exerciseDays) && exerciseDays >= 0 && exerciseDays <= 7;
}

function validateRound2Response(responses) {
  if (responses.length !== 5) return false;
  
  const [water, sleep, intimacy, stress, drinks] = responses;
  
  return !isNaN(water) && water >= 0 && water <= 10 &&
         !isNaN(sleep) && sleep >= 0 && sleep <= 5 &&
         ['Y', 'N'].includes(intimacy) &&
         !isNaN(stress) && stress >= 0 && stress <= 5 &&
         !isNaN(drinks) && drinks >= 0 && drinks <= 8;
}

function validateRound3Response(responses) {
  if (responses.length !== 14) return false;
  return responses.every(response => ['Y', 'N'].includes(response));
}

// Route to initiate onboarding
app.post('/start-onboarding', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    
    // Create or update user
    let user = await User.findOne({ phoneNumber: normalizedPhone });
    if (!user) {
      user = new User({ phoneNumber: normalizedPhone });
    }
    
    user.state = 'REGISTERED';
    await user.save();
    
    // Send initial message
    await sendWhatsAppMessage(phoneNumber, MESSAGES.INITIAL);
    
    // Send Round 1 questions after a short delay
    setTimeout(async () => {
      await sendWhatsAppMessage(phoneNumber, MESSAGES.ROUND_1);
      user.state = 'ROUND_1_SENT';
      await user.save();
    }, 3000);
    
    res.json({ success: true, message: 'WhatsApp onboarding started' });
  } catch (error) {
    console.error('Error starting onboarding:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.use('/api/friday', fridayNotification)

// Webhook for incoming WhatsApp messages
app.post('/webhook-reply', async (req, res) => {
  try {
    const { From, Body } = req.body;
    const phoneNumber = normalizePhoneNumber(From);
    const response = Body?.trim();
    
    console.log(`Received WhatsApp message from ${phoneNumber}: ${response}`);

    const isFridayResponse = await fridayNotificationController.handleFridayResponse(phoneNumber, response);
    if(isFridayResponse){
      console.log('Message handled by Friday notification system');
      return res.status(200).send("OK")
    }
    
    let user = await User.findOne({ phoneNumber });
    if (!user) {
      await sendWhatsAppMessage(From, "Sorry, I don't recognize your number. Please contact support to get started! 📞");
      return res.status(200).send();
    }
    
    // Handle HELP command
    if (response.toUpperCase() === 'HELP') {
      await sendWhatsAppMessage(From, MESSAGES.HELP);
      return res.status(200).send();
    }
    
    // Handle STOP command
    if (response.toUpperCase() === 'STOP') {
      user.state = 'ONBOARDING_COMPLETE';
      await user.save();
      await sendWhatsAppMessage(From, "Thanks for using DadBod! You've been unsubscribed. Contact support if you want to restart. 👋");
      return res.status(200).send();
    }
    
    // State machine logic
    switch (user.state) {
      case 'ROUND_1_SENT':
        await handleRound1Response(user, response, From);
        break;
        
      case 'ROUND_1_COMPLETE':
        await handleTransitionResponse(user, response, From, 'ROUND_2');
        break;
        
      case 'ROUND_2_SENT':
        await handleRound2Response(user, response, From);
        break;
        
      case 'ROUND_2_COMPLETE':
        await handleTransitionResponse(user, response, From, 'ROUND_3');
        break;
        
      case 'ROUND_3_SENT':
        await handleRound3Response(user, response, From);
        break;
        
      default:
        await sendWhatsAppMessage(From, "I'm not sure what you're responding to. Reply *HELP* for assistance. 🤔");
    }
    
    res.status(200).send();
  } catch (error) {
    console.error('Error processing WhatsApp webhook:', error);
    res.status(500).send();
  }
});

async function handleRound1Response(user, response, phoneNumber) {
  const responses = parseResponse(response, 'COMMA_SEPARATED');
  
  if (!validateRound1Response(responses)) {
    await sendWhatsAppMessage(phoneNumber, MESSAGES.ERROR);
    return;
  }
  
  // Save responses
  user.responses.round1 = {
    age: parseInt(responses[0]),
    weight: parseInt(responses[1]),
    targetWeightLoss: parseInt(responses[2]),
    alcoholDaysPerWeek: parseInt(responses[3]),
    exerciseDaysPerWeek: parseInt(responses[4])
  };
  
  user.state = 'ROUND_1_COMPLETE';
  user.updatedAt = new Date();
  await user.save();
  
  // Send transition message
  await sendWhatsAppMessage(phoneNumber, MESSAGES.TRANSITION_ROUND_2);
}

async function handleRound2Response(user, response, phoneNumber) {
  const responses = parseResponse(response, 'COMMA_SEPARATED');
  
  if (!validateRound2Response(responses)) {
    await sendWhatsAppMessage(phoneNumber, MESSAGES.ERROR);
    return;
  }
  
  // Save responses
  user.responses.round2 = {
    waterGlasses: parseInt(responses[0]),
    sleepQuality: parseInt(responses[1]),
    improveIntimacy: responses[2],
    stressLevel: parseInt(responses[3]),
    dailyDrinks: parseInt(responses[4])
  };
  
  user.state = 'ROUND_2_COMPLETE';
  user.updatedAt = new Date();
  await user.save();
  
  // Send transition message
  await sendWhatsAppMessage(phoneNumber, MESSAGES.TRANSITION_ROUND_3);
}

async function handleRound3Response(user, response, phoneNumber) {
  const responses = parseResponse(response, 'COMMA_SEPARATED');
  
  if (!validateRound3Response(responses)) {
    await sendWhatsAppMessage(phoneNumber, MESSAGES.ERROR);
    return;
  }
  
  // Save responses
  const healthConditions = [
    'highBloodPressure', 'type2Diabetes', 'cancer', 'osteoporosis',
    'heartDisease', 'smoking', 'neckPain', 'hearingLoss',
    'highCholesterol', 'anxiety', 'backPain', 'type1Diabetes',
    'depression', 'osteoarthritis'
  ];
  
  user.responses.round3 = {};
  healthConditions.forEach((condition, index) => {
    user.responses.round3[condition] = responses[index];
  });
  
  user.state = 'ONBOARDING_COMPLETE';
  user.updatedAt = new Date();
  await user.save();
  
  // Send completion message
  await sendWhatsAppMessage(phoneNumber, MESSAGES.COMPLETION);
}

async function handleTransitionResponse(user, response, phoneNumber, nextRound) {
  const answer = parseResponse(response, 'YN');
  
  if (answer === 'N') {
    // User wants to finish
    user.state = 'ONBOARDING_COMPLETE';
    await user.save();
    await sendWhatsAppMessage(phoneNumber, MESSAGES.COMPLETION);
  } else if (answer === 'Y') {
    // Send next round
    if (nextRound === 'ROUND_2') {
      await sendWhatsAppMessage(phoneNumber, MESSAGES.ROUND_2);
      user.state = 'ROUND_2_SENT';
    } else if (nextRound === 'ROUND_3') {
      await sendWhatsAppMessage(phoneNumber, MESSAGES.ROUND_3);
      user.state = 'ROUND_3_SENT';
    }
    await user.save();
  } else {
    await sendWhatsAppMessage(phoneNumber, "Please reply with *Y* to continue or *N* to finish setup. 🤔");
  }
}

// Get user data endpoint
app.get('/user/:phoneNumber', async (req, res) => {
  try {
    const phoneNumber = normalizePhoneNumber(req.params.phoneNumber);
    const user = await User.findOne({ phoneNumber });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all users endpoint
app.get('/users', async (req, res) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'DadBod WhatsApp Bot',
    timestamp: new Date().toISOString() 
  });
});

// Test WhatsApp endpoint
app.post('/test-whatsapp', async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;
    await sendWhatsAppMessage(phoneNumber, message || 'Test message from DadBod! 🎉');
    res.json({ success: true, message: 'Test message sent' });
  } catch (error) {
    console.error('Error sending test message:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`DadBod WhatsApp service running on port ${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook-reply`);
});

module.exports = app;