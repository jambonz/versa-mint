# versa-vapi

This application is designed for routing calls to Vapi via a defined TRUNK on Jambonz using the following command:

```sh
JAMBONZ_REST_API_BASE_URL=https://jambonz.one/api/v1 \
JAMBONZ_ACCOUNT_SID=3edac44e-60c1-4069-908f-a5e6ba984748 \
JAMBONZ_API_KEY=1cf2f4f4-64c4-4249-9a3e-5bb4cb597c21 \
npm start
```

### Environment Variables:
	•	JAMBONZ_REST_API_BASE_URL: The base URL of the Jambonz API server.
	•	JAMBONZ_ACCOUNT_SID: Your Jambonz account SID.
	•	JAMBONZ_API_KEY: Your Jambonz API key.
	* APP_TRUNK_NAME: Jambonz TRUNK NAME provisioned on jambonz for outbound call to VAPI
	* VERSA_BASE_URL: Versa API Server BASE URL
	* VERSA_API_KEY: API KEY for versa API server