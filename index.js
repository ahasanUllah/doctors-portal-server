const express = require('express');
const cors = require('cors');
require('dotenv').config();
var jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 5000;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

//middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DETABASE_USER}:${process.env.DETABASE_PASSWORD}@cluster0.2redmm4.mongodb.net/?retryWrites=true&w=majority`;

const verifyToken = (req, res, next) => {
   const authorization = req.headers.authorization;

   if (!authorization) {
      return res.status(401).send({ message: 'unauthorized access cannot get accesstoken' });
   }
   const token = authorization.split(' ')[1];
   jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
      if (err) {
         return res.status(401).send({ message: 'forbidden access' });
      }

      req.decoded = decoded;

      next();
   });
};

const client = new MongoClient(uri, {
   useNewUrlParser: true,
   useUnifiedTopology: true,
   serverApi: ServerApiVersion.v1,
});

const run = async () => {
   try {
      const appointmentCollection = client.db('doctorsPortal').collection('appointmentOptions');
      const bookingsCollection = client.db('doctorsPortal').collection('bookings');
      const usersCollection = client.db('doctorsPortal').collection('users');
      const paymentCollection = client.db('doctorsPortal').collection('payment');
      const doctorsCollection = client.db('doctorsPortal').collection('doctors');

      const verifyAdmin = async (req, res, next) => {
         const email = req.decoded.email;
         const query = { email: email };
         const user = await usersCollection.findOne(query);
         if (user?.role !== 'admin') {
            return res.status(403).send({ message: 'forbidden access' });
         }
         next();
      };

      app.get('/appointmentOptions', async (req, res) => {
         const date = req.query.date;
         const query = {};
         const bookingQuery = { appointmentDate: date };
         const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();
         const options = await appointmentCollection.find(query).toArray();

         options.forEach((option) => {
            const optionBooked = alreadyBooked.filter((book) => {
               return book.treatment === option.name;
            });
            const bookedSlots = optionBooked.map((book) => book.slots);
            const remainingSlots = option.slots.filter((slot) => !bookedSlots.includes(slot));
            option.slots = remainingSlots;
         });

         res.send(options);
      });

      app.get('/bookings', verifyToken, async (req, res) => {
         const email = req.query.email;
         const decodedEmail = req.decoded.email;

         if (email !== decodedEmail) {
            return res.status(403).send({ message: 'forbidden access' });
         }
         const query = {
            email: email,
         };
         const result = await bookingsCollection.find(query).toArray();
         res.send(result);
      });

      app.post('/create-payment-intent', async (req, res) => {
         const booking = req.body;
         const price = booking.price;
         const amount = price * 100;
         const paymentIntent = await stripe.paymentIntents.create({
            currency: 'usd',
            amount: amount,
            payment_method_types: ['card'],
         });
         res.send({
            clientSecret: paymentIntent.client_secret,
         });
      });

      app.get('/jwt', async (req, res) => {
         const email = req.query.email;
         const query = { email: email };
         const user = await usersCollection.findOne(query);
         if (user) {
            const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1d' });
            return res.send({ accessToken: token });
         }
         console.log(user);
         res.status(403).send({ accessToken: 'token' });
      });

      app.post('/users', async (req, res) => {
         const user = req.body;
         console.log(user);

         const result = await usersCollection.insertOne(user);
         res.send(result);
      });

      app.get('/users/admin/:email', async (req, res) => {
         const email = req.params.email;
         const query = { email };
         const user = await usersCollection.findOne(query);
         res.send({ isAdmin: user?.role === 'admin' });
      });

      app.get('/users', async (req, res) => {
         const query = {};
         const result = await usersCollection.find(query).toArray();
         res.send(result);
      });

      app.get('/doctorsspacialty', async (req, res) => {
         const query = {};
         const result = await appointmentCollection.find(query).project({ name: 1 }).toArray();
         res.send(result);
      });

      app.put('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
         const id = req.params.id;
         const filter = { _id: ObjectId(id) };
         const options = { upsert: true };
         const updatedDoc = {
            $set: {
               role: 'admin',
            },
         };
         const result = await usersCollection.updateOne(filter, updatedDoc, options);
         res.send(result);
      });
      //Update/ insert price in the appointment option
      // app.get('/addprice', async (req, res) => {
      //    const filter = {};
      //    const options = { upsert: true };
      //    const updatedDoc = {
      //       $set: {
      //          price: 99,
      //       },
      //    };
      //    const result = await appointmentCollection.updateMany(filter, updatedDoc, options);
      //    res.send(result);
      // });

      app.post('/doctors', verifyToken, verifyAdmin, async (req, res) => {
         const doctors = req.body;
         const result = await doctorsCollection.insertOne(doctors);
         res.send(result);
      });

      app.get('/doctors', verifyToken, verifyAdmin, async (req, res) => {
         const query = {};
         const result = await doctorsCollection.find(query).toArray();
         res.send(result);
      });

      app.delete('/doctors/:id', verifyToken, async (req, res) => {
         const id = req.params.id;
         const email = req.decoded.email;
         console.log(email);

         const query = { _id: ObjectId(id) };
         const result = await doctorsCollection.deleteOne(query);
         res.send(result);
      });

      app.post('/bookings', async (req, res) => {
         const booking = req.body;
         console.log(booking);
         const query = {
            appointmentDate: booking.appointmentDate,
            treatment: booking.treatment,
            email: booking.email,
         };
         const alreadyBooked = await bookingsCollection.find(query).toArray();
         if (alreadyBooked.length) {
            const message = `you already booked on ${booking.appointmentDate}`;
            return res.send({ acknowledged: false, message });
         }
         const result = await bookingsCollection.insertOne(booking);
         res.send(result);
      });

      app.get('/booking/:id', async (req, res) => {
         const id = req.params.id;
         const query = { _id: ObjectId(id) };
         const result = await bookingsCollection.findOne(query);
         res.send(result);
      });
      app.post('/payment', async (req, res) => {
         const payment = req.body;
         const result = await paymentCollection.insertOne(payment);
         const id = payment.bookingId;
         const filter = { _id: ObjectId(id) };
         const updatedDoc = {
            $set: {
               paid: true,
               transactionId: payment.transactionId,
            },
         };
         const updatedResult = await bookingsCollection.updateOne(filter, updatedDoc);
         res.send(result);
      });
   } finally {
   }
};
run().catch((error) => console.log(error));

app.get('/', async (req, res) => {
   res.send('doctors portal server is running');
});

app.listen(port, () => console.log(`Doctors portal running on ${port}`));
