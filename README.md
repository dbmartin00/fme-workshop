This README is not a walkthrough. These are instructions for creating a workshop for a customer.

Using node.js

Clone the fme-workshop repository, 

https://github.com/dbmartin00/fme-workshop

```
npm install
```

Edit the config file JSON

```
{
  "emails": [
    "admin@example.com",
    "developer@example.com",
    "owner@example.com"
  ],  
  "apiKey": "sat.******** etc."
  "accountIdentifier": "<from your logged in url>",
  "orgIdentifier": "<from your logged in url>"
}
```

Your account level API key will need specific bindings:

 - FME Administrator
 - FME Manager
 - FME Account API (or Account Admin)

Run the generator

```
node index.js
```

You create a new Workshop project with the usual suspects for flags.

A new ZIP is created in the downloads subdirectory and your email addresses are printed out as a comma-separated list.  You need to email your customers with the ZIP attachment yourself.  This is no longer done by Workshop.

Your download ZIP is the only copy that exists when you create it.


To be fixed...

Customer-facing README.html is currently empty


