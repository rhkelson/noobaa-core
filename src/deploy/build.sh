#
#zip and upload to amazon s3 with public permissions
#
rm DockerClient.zip
zip DockerClient.zip Dockerfile docker_setup.sh init.sh run-agent.sh start_noobaa_docker.sh supervisord.conf 
/Users/eran/Downloads/s3cmd-1.5.0-rc1/s3cmd ls s3://elasticbeanstalk-us-west-2-628038730422
/Users/eran/Downloads/s3cmd-1.5.0-rc1/s3cmd -P put DockerClient.zip s3://elasticbeanstalk-us-west-2-628038730422
/Users/eran/Downloads/s3cmd-1.5.0-rc1/s3cmd -P put docker_setup.sh s3://elasticbeanstalk-us-west-2-628038730422
/Users/eran/Downloads/s3cmd-1.5.0-rc1/s3cmd -P put init_agent.sh s3://elasticbeanstalk-us-west-2-628038730422
/Users/eran/Downloads/s3cmd-1.5.0-rc1/s3cmd -P put init_agent_client.sh s3://elasticbeanstalk-us-west-2-628038730422
/Users/eran/Downloads/s3cmd-1.5.0-rc1/s3cmd -P put init_agent_test.sh s3://elasticbeanstalk-us-west-2-628038730422